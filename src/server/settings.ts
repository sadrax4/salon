import type { Db } from "./db.ts";
import { DEFAULT_DEPOSIT_RULE, type DepositRule } from "../domain/deposit.ts";
import { DEFAULT_CANCELLATION, type CancellationPolicy } from "../domain/cancellation.ts";

export interface BookingSettings {
  timeZone: string; holdMinutes: number; rejectedGraceMinutes: number; bufferMin: number; stepMin: number;
  minAdvanceMin: number; maxAdvanceDays: number; maxBookingsPerDay: number | null; depositRoundingRial: number;
  anyTechnicianEnabled: boolean; globalDeposit: DepositRule; cancellation: CancellationPolicy;
}
export const BOOKING_DEFAULTS: BookingSettings = {
  timeZone: "Asia/Tehran", holdMinutes: 15, rejectedGraceMinutes: 60, bufferMin: 10, stepMin: 30,
  minAdvanceMin: 120, maxAdvanceDays: 60, maxBookingsPerDay: null, depositRoundingRial: 10,
  anyTechnicianEnabled: true, globalDeposit: DEFAULT_DEPOSIT_RULE, cancellation: DEFAULT_CANCELLATION,
};
/** Every key is owner-editable in the dashboard (stored in Setting as `booking.<name>`); missing => default. */
export async function loadBookingSettings(db: Db): Promise<BookingSettings> {
  const rows = await db.setting.findMany({ where: { key: { startsWith: "booking." } } });
  const out: Record<string, unknown> = { ...BOOKING_DEFAULTS };
  for (const r of rows) out[r.key.slice("booking.".length)] = r.value;
  return out as unknown as BookingSettings;
}
