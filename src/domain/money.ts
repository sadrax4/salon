/**
 * MONEY CONVENTION (documented, enforced here only):
 *  - Every stored/computed amount is an INTEGER number of RIAL.
 *  - 1 Toman = 10 Rial. Toman is a DISPLAY unit only (customer-facing).
 *  - Percentages are stored as basis points (bp): 3000 bp = 30%.
 *  - No floating point is used for money. BigInt guards against overflow.
 */
export type Rial = number;
export const RIAL_PER_TOMAN = 10;

export function assertRial(v: number, label = "amount"): asserts v is Rial {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${label} must be a non-negative safe integer (Rial)`);
}

export function tomanToRial(toman: number): Rial {
  if (!Number.isSafeInteger(toman) || toman < 0) throw new RangeError("toman must be a non-negative integer");
  return toman * RIAL_PER_TOMAN;
}

/** Rial -> whole Toman (floor). Use only for display. */
export function rialToToman(rial: Rial): number {
  assertRial(rial);
  return Math.floor(rial / RIAL_PER_TOMAN);
}

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** e.g. 1250000 Rial -> "۱۲۵٬۰۰۰ تومان" */
export function formatToman(rial: Rial): string {
  const t = String(rialToToman(rial)).replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  return `${toPersianDigits(t)} تومان`;
}

/** basis-point share of an amount, rounded half-up, exact via BigInt. */
export function percentOf(amount: Rial, basisPoints: number): Rial {
  assertRial(amount);
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000)
    throw new RangeError("basisPoints must be an integer 0..10000");
  return Number((BigInt(amount) * BigInt(basisPoints) + 5000n) / 10000n);
}

/** Round UP to a multiple of `unit` Rial (unit>=1). */
export function roundUpTo(amount: Rial, unit: number): Rial {
  assertRial(amount);
  if (!Number.isInteger(unit) || unit < 1) throw new RangeError("unit must be >= 1");
  return Math.ceil(amount / unit) * unit;
}
