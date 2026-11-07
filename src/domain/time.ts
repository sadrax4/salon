/** Timezone helpers. All instants are epoch-ms UTC; "local" means salon timezone (default Asia/Tehran). */
import type { YMD } from "./jalali.ts";
export const DEFAULT_TZ = "Asia/Tehran";
export interface Interval { start: number; end: number } // [start, end) epoch ms

export function tzOffsetMs(epochMs: number, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(epochMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Local wall-clock (y-m-d + minutes since local midnight) -> UTC epoch ms. */
export function localToUtc(d: YMD, minutes: number, timeZone = DEFAULT_TZ): number {
  const naive = Date.UTC(d.y, d.m - 1, d.d, 0, minutes);
  let t = naive - tzOffsetMs(naive, timeZone);
  t = naive - tzOffsetMs(t, timeZone); // re-evaluate once (DST-safe)
  return t;
}
export function utcToLocalYMD(epochMs: number, timeZone = DEFAULT_TZ): YMD & { minutes: number; weekdayJs: number } {
  const o = tzOffsetMs(epochMs, timeZone);
  const dt = new Date(epochMs + o);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), minutes: dt.getUTCHours() * 60 + dt.getUTCMinutes(), weekdayJs: dt.getUTCDay() };
}
export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x.start, y.start), e = Math.min(x.end, y.end);
    if (s < e) out.push({ start: s, end: e });
  }
  return out.sort((p, q) => p.start - q.start);
}
export function subtract(base: Interval[], cuts: Interval[]): Interval[] {
  let cur = base.map((i) => ({ ...i }));
  for (const c of cuts) {
    const next: Interval[] = [];
    for (const i of cur) {
      if (!overlaps(i, c)) { next.push(i); continue; }
      if (i.start < c.start) next.push({ start: i.start, end: c.start });
      if (c.end < i.end) next.push({ start: c.end, end: i.end });
    }
    cur = next;
  }
  return cur.sort((p, q) => p.start - q.start);
}
