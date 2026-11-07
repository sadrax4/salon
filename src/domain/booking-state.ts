import type { Permission } from "./permissions.ts";

export type BookingStatus =
  | "PENDING_PAYMENT" | "VERIFICATION_PENDING" | "CONFIRMED" | "PAYMENT_REJECTED"
  | "COMPLETED" | "NO_SHOW" | "CANCELLED" | "EXPIRED";

export type PaymentStatus =
  | "DEPOSIT_REQUIRED" | "AWAITING_CUSTOMER_PAYMENT" | "PAYMENT_VERIFICATION_PENDING" | "DEPOSIT_APPROVED"
  | "PAYMENT_REJECTED" | "BOOKING_CONFIRMED" | "PARTIALLY_PAID" | "FULLY_PAID" | "REFUND_RECORDED";

export type Actor = { kind: "customer" } | { kind: "system" } | { kind: "staff"; permissions: ReadonlySet<string> };
export interface TransitionContext {
  actor: Actor;
  depositRequiredRial: number;
  depositApprovedRial: number; // sum of deposit records an authorised admin has APPROVED
}
export class TransitionError extends Error { constructor(m: string) { super(m); this.name = "TransitionError"; } }

const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  PENDING_PAYMENT: ["VERIFICATION_PENDING", "EXPIRED", "CANCELLED", "CONFIRMED"],
  VERIFICATION_PENDING: ["CONFIRMED", "PAYMENT_REJECTED", "CANCELLED"],
  PAYMENT_REJECTED: ["VERIFICATION_PENDING", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["COMPLETED", "NO_SHOW", "CANCELLED"],
  COMPLETED: [], NO_SHOW: [], CANCELLED: [], EXPIRED: [],
};
export const TERMINAL: ReadonlySet<BookingStatus> = new Set(["COMPLETED", "NO_SHOW", "CANCELLED", "EXPIRED"]);
/** Statuses whose slot must be treated as occupied (confirmed OR still being held / verified). */
export const SLOT_OCCUPYING: readonly BookingStatus[] = ["PENDING_PAYMENT", "VERIFICATION_PENDING", "PAYMENT_REJECTED", "CONFIRMED"];

const hasPerm = (a: Actor, p: Permission) => a.kind === "staff" && a.permissions.has(p);

/**
 * Single choke point for every booking status change. Throws TransitionError if not allowed.
 * KEY INVARIANT: only a staff actor holding `payment.approve` can move a booking to CONFIRMED
 * after a deposit declaration, and only when approved deposits cover the required deposit.
 * A customer (or the system) can NEVER confirm. A receipt upload never changes status by itself.
 */
export function assertTransition(from: BookingStatus, to: BookingStatus, ctx: TransitionContext): void {
  if (!ALLOWED[from].includes(to)) throw new TransitionError(`Transition ${from} -> ${to} is not allowed`);
  const { actor } = ctx;
  switch (to) {
    case "VERIFICATION_PENDING": // customer clicked "I have paid" (or re-submitted evidence)
      if (actor.kind !== "customer" && !hasPerm(actor, "booking.edit")) throw new TransitionError("Only the customer or an editor can declare payment");
      return;
    case "CONFIRMED":
      if (from === "VERIFICATION_PENDING") {
        if (!hasPerm(actor, "payment.approve")) throw new TransitionError("Only an authorised admin can approve a deposit");
        if (ctx.depositApprovedRial < ctx.depositRequiredRial) throw new TransitionError("Approved deposit does not cover the required deposit");
        return;
      }
      // PENDING_PAYMENT -> CONFIRMED is only for bookings with no deposit due, created by staff
      if (ctx.depositRequiredRial > 0) throw new TransitionError("Deposit required: booking can only be confirmed after admin verification");
      if (!hasPerm(actor, "booking.edit")) throw new TransitionError("Not permitted");
      return;
    case "PAYMENT_REJECTED":
      if (!hasPerm(actor, "payment.approve")) throw new TransitionError("Only an authorised admin can reject a deposit");
      return;
    case "EXPIRED":
      if (actor.kind !== "system") throw new TransitionError("Only the system expires holds");
      return;
    case "CANCELLED":
      if (actor.kind === "system") throw new TransitionError("System cannot cancel");
      if (actor.kind === "staff" && !hasPerm(actor, "booking.cancel")) throw new TransitionError("Not permitted to cancel");
      return;
    case "COMPLETED":
    case "NO_SHOW":
      if (!hasPerm(actor, "booking.update_status")) throw new TransitionError("Not permitted to update status");
      return;
  }
}

export interface PaymentFacts {
  status: BookingStatus;
  totalRial: number;
  depositRequiredRial: number;
  depositApprovedRial: number;
  balancePaidRial: number;   // in-salon payments recorded by staff
  refundedRial: number;
  hasPendingEvidence: boolean;
}
export function remainingBalanceRial(f: PaymentFacts): number {
  return Math.max(0, f.totalRial - f.depositApprovedRial - f.balancePaidRial);
}
export function derivePaymentStatus(f: PaymentFacts): PaymentStatus {
  if (f.refundedRial > 0) return "REFUND_RECORDED";
  const paid = f.depositApprovedRial + f.balancePaidRial;
  if (f.totalRial > 0 && paid >= f.totalRial) return "FULLY_PAID";
  if (f.balancePaidRial > 0) return "PARTIALLY_PAID";
  if (f.status === "PAYMENT_REJECTED") return "PAYMENT_REJECTED";
  if (f.status === "VERIFICATION_PENDING") return "PAYMENT_VERIFICATION_PENDING";
  if (f.status === "CONFIRMED" || f.status === "COMPLETED") return f.depositRequiredRial > 0 ? "BOOKING_CONFIRMED" : "DEPOSIT_REQUIRED";
  if (f.depositApprovedRial >= f.depositRequiredRial && f.depositRequiredRial > 0) return "DEPOSIT_APPROVED";
  return f.hasPendingEvidence ? "PAYMENT_VERIFICATION_PENDING" : "AWAITING_CUSTOMER_PAYMENT";
}
