import type { Db } from "./db.ts";
import { computeAvailableSlots } from "../domain/availability.ts";
import { localToUtc } from "../domain/time.ts";
import { weekdayIndexSatFirst, type YMD } from "../domain/jalali.ts";
import { SLOT_OCCUPYING } from "../domain/booking-state.ts";
import type { BookingSettings } from "./settings.ts";

/** Loads everything for one technician on one local date and runs the pure engine. */
export async function slotsForStaff(db: Db, staffId: string, date: YMD, durationMin: number, s: BookingSettings, now = Date.now()) {
  const dayStart = localToUtc(date, 0, s.timeZone), dayEnd = localToUtc(date, 1440, s.timeZone);
  const wd = weekdayIndexSatFirst(new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay());
  const range = { gt: new Date(dayStart - 864e5), lt: new Date(dayEnd + 864e5) };
  const [staff, bh, holidays, bookings] = await Promise.all([
    db.staffProfile.findUnique({ where: { id: staffId }, include: { schedules: { where: { weekday: wd } }, breaks: { where: { weekday: wd } }, timeOff: { where: { endsAt: { gt: new Date(dayStart) }, startsAt: { lt: new Date(dayEnd) } } } } }),
    db.businessHours.findMany({ where: { weekday: wd } }),
    db.businessHoliday.findMany({ where: { endsAt: { gt: new Date(dayStart) }, startsAt: { lt: new Date(dayEnd) } } }),
    db.booking.findMany({ where: { staffId, startsAt: range, status: { in: [...SLOT_OCCUPYING] }, OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date(now) } }] } }),
  ]);
  if (!staff || !staff.active) return [];
  const t = (d: Date) => d.getTime();
  const sameDay = bookings.filter((b) => t(b.startsAt) >= dayStart && t(b.startsAt) < dayEnd).length;
  return computeAvailableSlots({
    date, timeZone: s.timeZone, durationMin, bufferMin: s.bufferMin, stepMin: s.stepMin,
    businessHours: bh.map((x) => ({ startMin: x.startMin, endMin: x.endMin })),
    staffHours: staff.schedules.map((x) => ({ startMin: x.startMin, endMin: x.endMin })),
    breaks: staff.breaks.map((x) => ({ startMin: x.startMin, endMin: x.endMin })),
    closures: [...holidays, ...staff.timeOff].map((x) => ({ start: t(x.startsAt), end: t(x.endsAt) })),
    busy: bookings.map((b) => ({ start: t(b.startsAt), end: t(b.endsAt) })),
    now, minAdvanceMin: s.minAdvanceMin, maxAdvanceDays: s.maxAdvanceDays,
    maxBookingsPerDay: staff.maxBookingsPerDay ?? s.maxBookingsPerDay ?? undefined, bookingsAlreadyThatDay: sameDay,
  });
}
