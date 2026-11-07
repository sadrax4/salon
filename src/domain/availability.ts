import { type Interval, intersect, subtract, overlaps, localToUtc, DEFAULT_TZ } from "./time.ts";
import type { YMD } from "./jalali.ts";

export interface LocalWindow { startMin: number; endMin: number } // minutes since local midnight

export interface AvailabilityInput {
  date: YMD;                    // local calendar date
  timeZone?: string;
  durationMin: number;          // total service duration (internal only)
  bufferMin: number;            // cleanup buffer after each appointment
  stepMin: number;              // slot granularity
  businessHours: LocalWindow[]; // for that weekday ([] => closed)
  staffHours: LocalWindow[];    // for that weekday ([] => not working)
  breaks: LocalWindow[];        // recurring breaks that weekday
  closures: Interval[];         // UTC: business holidays, staff leave/time-off
  busy: Interval[];             // UTC: confirmed/pending bookings + ACTIVE holds (raw appointment times)
  now: number;                  // epoch ms
  minAdvanceMin: number;
  maxAdvanceDays: number;
  maxBookingsPerDay?: number;
  bookingsAlreadyThatDay?: number;
}

const toUtc = (d: YMD, w: LocalWindow[], tz: string): Interval[] =>
  w.filter((x) => x.endMin > x.startMin).map((x) => ({ start: localToUtc(d, x.startMin, tz), end: localToUtc(d, x.endMin, tz) }));

/** Returns slot START times (epoch ms) that are genuinely bookable. Pure & deterministic. */
export function computeAvailableSlots(i: AvailabilityInput): number[] {
  const tz = i.timeZone ?? DEFAULT_TZ;
  if (i.durationMin <= 0 || i.stepMin <= 0) throw new RangeError("duration and step must be positive");
  if (i.maxBookingsPerDay != null && (i.bookingsAlreadyThatDay ?? 0) >= i.maxBookingsPerDay) return [];

  const work = intersect(toUtc(i.date, i.businessHours, tz), toUtc(i.date, i.staffHours, tz));
  const free = subtract(work, [...toUtc(i.date, i.breaks, tz), ...i.closures]);

  const earliest = i.now + i.minAdvanceMin * 60_000;
  const latest = i.now + i.maxAdvanceDays * 86_400_000;
  const dur = i.durationMin * 60_000, buf = i.bufferMin * 60_000, step = i.stepMin * 60_000;
  const midnight = localToUtc(i.date, 0, tz);

  const slots: number[] = [];
  for (const w of free) {
    // align candidates to the step grid measured from local midnight
    let s = midnight + Math.ceil((w.start - midnight) / step) * step;
    for (; s + dur <= w.end; s += step) {
      if (s < earliest || s > latest) continue;
      const candidate: Interval = { start: s, end: s + dur + buf };
      // an existing appointment also occupies its trailing buffer
      if (i.busy.some((b) => overlaps(candidate, { start: b.start, end: b.end + buf }))) continue;
      slots.push(s);
    }
  }
  return slots;
}
