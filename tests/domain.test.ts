import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAvailableSlots, type AvailabilityInput } from "../src/domain/availability.ts";
import { localToUtc, utcToLocalYMD, tzOffsetMs } from "../src/domain/time.ts";
import { assertTransition, derivePaymentStatus, remainingBalanceRial, TransitionError, type TransitionContext } from "../src/domain/booking-state.ts";
import { effectivePermissions, requirePermission, ForbiddenError } from "../src/domain/permissions.ts";
import { evaluateCancellation } from "../src/domain/cancellation.ts";

const D = { y: 2026, m: 11, d: 7 }; // a Saturday
const T = (min: number) => localToUtc(D, min);
const base = (o: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  date: D, durationMin: 60, bufferMin: 10, stepMin: 30,
  businessHours: [{ startMin: 9 * 60, endMin: 18 * 60 }], staffHours: [{ startMin: 10 * 60, endMin: 16 * 60 }],
  breaks: [{ startMin: 12 * 60, endMin: 13 * 60 }], closures: [], busy: [],
  now: localToUtc({ y: 2026, m: 11, d: 5 }, 8 * 60), minAdvanceMin: 120, maxAdvanceDays: 60, ...o,
});
const hhmm = (s: number[]) => s.map((x) => { const l = utcToLocalYMD(x); return `${String(Math.floor(l.minutes / 60)).padStart(2, "0")}:${String(l.minutes % 60).padStart(2, "0")}`; });

test("tz: Tehran is fixed UTC+03:30 (no DST) and round-trips", () => {
  assert.equal(tzOffsetMs(Date.UTC(2026, 6, 1), "Asia/Tehran"), 3.5 * 3600_000);
  assert.equal(tzOffsetMs(Date.UTC(2026, 0, 1), "Asia/Tehran"), 3.5 * 3600_000);
  assert.equal(T(10 * 60), Date.UTC(2026, 10, 7, 6, 30));
  assert.equal(utcToLocalYMD(T(615)).minutes, 615);
});
test("availability: intersection of business+staff hours, break removed, last slot fits", () => {
  const s = hhmm(computeAvailableSlots(base()));
  assert.deepEqual(s, ["10:00", "10:30", "11:00", "13:00", "13:30", "14:00", "14:30", "15:00"]);
  // 11:00 slot ends 12:00 exactly at break start => allowed; 11:30 would cross the break => absent
  assert.ok(!s.includes("11:30") && !s.includes("12:00") && !s.includes("15:30"));
});
test("availability: existing booking + buffer removes overlapping slots", () => {
  const busy = [{ start: T(13 * 60), end: T(14 * 60) }];
  const s = hhmm(computeAvailableSlots(base({ busy })));
  // appointment occupies 13:00-14:00 plus 10 min buffer => 14:00 start blocked? candidate 14:00 overlaps [13:00,14:10) -> blocked
  assert.deepEqual(s, ["10:00", "10:30", "11:00", "14:30", "15:00"]);
});
test("availability: a candidate whose buffer would clash with the next booking is rejected", () => {
  const busy = [{ start: T(11 * 60), end: T(11 * 60 + 30) }];
  const s = hhmm(computeAvailableSlots(base({ busy, durationMin: 30 })));
  assert.ok(!s.includes("10:30")); // 10:30-11:00 + 10min buffer touches 11:00
  assert.ok(s.includes("10:00"));
});
test("availability: closures, minimum advance, max window, daily cap", () => {
  assert.deepEqual(computeAvailableSlots(base({ closures: [{ start: T(0), end: T(24 * 60) }] })), []);
  const now = T(10 * 60);
  const s = hhmm(computeAvailableSlots(base({ now, minAdvanceMin: 120 })));
  assert.equal(s[0], "13:00"); // 10:00 + 2h => earliest 12:00, break until 13:00
  assert.deepEqual(computeAvailableSlots(base({ maxAdvanceDays: 1 })), []); // Nov 7 is >1 day from Nov 5 08:00
  assert.deepEqual(computeAvailableSlots(base({ maxBookingsPerDay: 3, bookingsAlreadyThatDay: 3 })), []);
  assert.deepEqual(computeAvailableSlots(base({ businessHours: [] })), []);
  assert.deepEqual(computeAvailableSlots(base({ staffHours: [] })), []);
});

const staff = (...p: string[]) => ({ kind: "staff" as const, permissions: new Set(p) });
const ctx = (actor: TransitionContext["actor"], req = 3_000_000, ok = 0): TransitionContext => ({ actor, depositRequiredRial: req, depositApprovedRial: ok });
test("state: customer/system can NEVER confirm; declaring payment only reaches verification", () => {
  assertTransition("PENDING_PAYMENT", "VERIFICATION_PENDING", ctx({ kind: "customer" }));
  assert.throws(() => assertTransition("PENDING_PAYMENT", "CONFIRMED", ctx({ kind: "customer" })), TransitionError);
  assert.throws(() => assertTransition("VERIFICATION_PENDING", "CONFIRMED", ctx({ kind: "customer" }, 3_000_000, 3_000_000)), TransitionError);
  assert.throws(() => assertTransition("VERIFICATION_PENDING", "CONFIRMED", ctx({ kind: "system" }, 3_000_000, 3_000_000)), TransitionError);
});
test("state: confirmation needs payment.approve AND approved amount >= required", () => {
  assert.throws(() => assertTransition("VERIFICATION_PENDING", "CONFIRMED", ctx(staff("booking.edit"), 3_000_000, 3_000_000)));
  assert.throws(() => assertTransition("VERIFICATION_PENDING", "CONFIRMED", ctx(staff("payment.approve"), 3_000_000, 1_000_000)));
  assertTransition("VERIFICATION_PENDING", "CONFIRMED", ctx(staff("payment.approve"), 3_000_000, 3_000_000));
  assert.throws(() => assertTransition("PENDING_PAYMENT", "CONFIRMED", ctx(staff("booking.edit"), 3_000_000)));
  assertTransition("PENDING_PAYMENT", "CONFIRMED", ctx(staff("booking.edit"), 0)); // no deposit due
});
test("state: reject, expire, terminal states, staff limits", () => {
  assertTransition("VERIFICATION_PENDING", "PAYMENT_REJECTED", ctx(staff("payment.approve")));
  assert.throws(() => assertTransition("VERIFICATION_PENDING", "PAYMENT_REJECTED", ctx(staff("booking.update_status"))));
  assertTransition("PAYMENT_REJECTED", "VERIFICATION_PENDING", ctx({ kind: "customer" })); // resubmit evidence
  assertTransition("PENDING_PAYMENT", "EXPIRED", ctx({ kind: "system" }));
  assert.throws(() => assertTransition("PENDING_PAYMENT", "EXPIRED", ctx({ kind: "customer" })));
  assert.throws(() => assertTransition("CANCELLED", "CONFIRMED", ctx(staff("payment.approve"), 0)));
  assertTransition("CONFIRMED", "COMPLETED", ctx(staff("booking.update_status")));
  assert.throws(() => assertTransition("CONFIRMED", "COMPLETED", ctx({ kind: "customer" })));
});
test("payment status & balance", () => {
  const f = { status: "VERIFICATION_PENDING" as const, totalRial: 10_000_000, depositRequiredRial: 3_000_000, depositApprovedRial: 0, balancePaidRial: 0, refundedRial: 0, hasPendingEvidence: true };
  assert.equal(derivePaymentStatus(f), "PAYMENT_VERIFICATION_PENDING");
  assert.equal(derivePaymentStatus({ ...f, status: "PENDING_PAYMENT", hasPendingEvidence: false }), "AWAITING_CUSTOMER_PAYMENT");
  const c = { ...f, status: "CONFIRMED" as const, depositApprovedRial: 3_000_000 };
  assert.equal(derivePaymentStatus(c), "BOOKING_CONFIRMED");
  assert.equal(remainingBalanceRial(c), 7_000_000);
  assert.equal(derivePaymentStatus({ ...c, balancePaidRial: 2_000_000 }), "PARTIALLY_PAID");
  assert.equal(derivePaymentStatus({ ...c, balancePaidRial: 7_000_000 }), "FULLY_PAID");
  assert.equal(derivePaymentStatus({ ...c, status: "CANCELLED", refundedRial: 3_000_000 }), "REFUND_RECORDED");
  assert.equal(derivePaymentStatus({ ...f, status: "PAYMENT_REJECTED" }), "PAYMENT_REJECTED");
});
test("permissions: staff restricted; owner-only can't be granted to others", () => {
  const st = effectivePermissions("STAFF");
  assert.throws(() => requirePermission(st, "payment.settings"), ForbiddenError);
  assert.throws(() => requirePermission(st, "report.financial"), ForbiddenError);
  const sneaky = effectivePermissions("MANAGER", ["payment.settings", "role.manage", "payment.approve"]);
  assert.ok(!sneaky.has("payment.settings") && !sneaky.has("role.manage"));
  assert.ok(sneaky.has("payment.approve")); // owner may delegate approval
  assert.ok(effectivePermissions("OWNER").has("payment.settings"));
  assert.equal(effectivePermissions("CUSTOMER").size, 0);
  assert.ok(!effectivePermissions("MANAGER", [], ["booking.edit"]).has("booking.edit"));
});
test("cancellation: free window, non-refundable after, configurable", () => {
  const now = Date.UTC(2026, 10, 5, 10), h = 3_600_000;
  let r = evaluateCancellation(now + 48 * h, now, 3_000_000);
  assert.deepEqual([r.withinFreeWindow, r.eligibleRefundRial], [true, 3_000_000]);
  r = evaluateCancellation(now + 23 * h, now, 3_000_000);
  assert.deepEqual([r.withinFreeWindow, r.eligibleRefundRial], [false, 0]);
  r = evaluateCancellation(now + 23 * h, now, 3_000_000, { freeCancelHoursBefore: 24, refundBasisPointsAfterWindow: 5000 });
  assert.equal(r.eligibleRefundRial, 1_500_000);
});
