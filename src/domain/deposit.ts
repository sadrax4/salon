import { type Rial, assertRial, percentOf, roundUpTo } from "./money.ts";

export type DepositRule =
  | { type: "PERCENT"; basisPoints: number }
  | { type: "FIXED"; amountRial: Rial };

export const DEFAULT_DEPOSIT_RULE: DepositRule = { type: "PERCENT", basisPoints: 3000 }; // 30%

export interface ServiceLine {
  priceRial: Rial;
  /** per-service override; null/undefined => use global rule */
  depositRule?: DepositRule | null;
  depositRequired?: boolean; // default true
}

export interface DepositResult {
  totalRial: Rial;
  depositRial: Rial;
  remainingRial: Rial;
}

function lineDeposit(l: ServiceLine, global: DepositRule): Rial {
  if (l.depositRequired === false) return 0;
  const rule = l.depositRule ?? global;
  const raw = rule.type === "PERCENT" ? percentOf(l.priceRial, rule.basisPoints) : rule.amountRial;
  assertRial(raw, "deposit");
  return Math.min(raw, l.priceRial); // a deposit can never exceed the line price
}

/**
 * Deposit for a multi-service booking = sum of per-service deposits,
 * rounded UP to `roundingUnitRial` (default 10 Rial = whole Toman) and capped at total.
 */
export function calculateDeposit(
  lines: ServiceLine[],
  global: DepositRule = DEFAULT_DEPOSIT_RULE,
  roundingUnitRial = 10,
  discountRial: Rial = 0,
): DepositResult {
  const gross = lines.reduce((s, l) => s + l.priceRial, 0);
  assertRial(discountRial, "discount");
  const totalRial = Math.max(0, gross - discountRial);
  let dep = lines.reduce((s, l) => s + lineDeposit(l, global), 0);
  if (gross > 0 && discountRial > 0) dep = Math.floor((dep * totalRial) / gross); // proportional
  dep = Math.min(roundUpTo(dep, roundingUnitRial), totalRial);
  return { totalRial, depositRial: dep, remainingRial: totalRial - dep };
}
