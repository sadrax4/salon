export interface CancellationPolicy {
  freeCancelHoursBefore: number;      // default 24
  refundBasisPointsAfterWindow: number; // default 0 => deposit non-refundable after the free window
}
export const DEFAULT_CANCELLATION: CancellationPolicy = { freeCancelHoursBefore: 24, refundBasisPointsAfterWindow: 0 };

/** Returns what the policy ALLOWS. Refunds are never automatic: an admin records them manually. */
export function evaluateCancellation(startsAtMs: number, nowMs: number, depositPaidRial: number, p = DEFAULT_CANCELLATION) {
  const hoursBefore = (startsAtMs - nowMs) / 3_600_000;
  const free = hoursBefore >= p.freeCancelHoursBefore;
  const bp = free ? 10000 : p.refundBasisPointsAfterWindow;
  const eligibleRefundRial = Number((BigInt(depositPaidRial) * BigInt(bp)) / 10000n);
  return { withinFreeWindow: free, eligibleRefundRial, hoursBefore, started: startsAtMs <= nowMs };
}
