// UNEXECUTED against a real database (no Postgres in the authoring sandbox). Domain rules it calls ARE unit-tested.
import { Prisma } from "@prisma/client";
import type { Db } from "./db.ts";
import { loadBookingSettings, type BookingSettings } from "./settings.ts";
import { slotsForStaff } from "./availability.ts";
import { calculateDeposit, type DepositRule } from "../domain/deposit.ts";
import { assertTransition, type Actor } from "../domain/booking-state.ts";
import { normalizeIranMobile } from "../domain/phone.ts";
import { utcToLocalYMD } from "../domain/time.ts";
import { generateBookingReference } from "../lib/security.ts";
import { evaluateCancellation } from "../domain/cancellation.ts";

export class BookingError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "BookingError"; this.code = code; }
}
const isOverlapViolation = (e: unknown) => String((e as Error)?.message ?? e).match(/booking_no_overlap|23P01/) !== null;
const ruleOf = (s: { depositType: string | null; depositPercentBp: number | null; depositFixedRial: number | null }): DepositRule | null =>
  s.depositType === "PERCENT" && s.depositPercentBp != null ? { type: "PERCENT", basisPoints: s.depositPercentBp }
  : s.depositType === "FIXED" && s.depositFixedRial != null ? { type: "FIXED", amountRial: s.depositFixedRial } : null;

/** Releases stale holds. Called by the scheduler AND inside every booking transaction (so job lag can't block a slot). */
export async function expireStaleHolds(tx: Prisma.TransactionClient | Db, now = new Date()) {
  const r = await tx.booking.updateMany({
    where: { status: { in: ["PENDING_PAYMENT", "PAYMENT_REJECTED"] }, holdExpiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
  return r.count; // caller may trigger waitlist notifications when > 0
}

export interface CreateBookingInput {
  serviceIds: string[]; staffId: string; startsAt: number; fullName: string; phone: string; email?: string; notes?: string;
  source?: "ONLINE" | "ADMIN"; actor?: Actor;
}
export async function createBooking(db: Db, input: CreateBookingInput, now = Date.now()) {
  const s = await loadBookingSettings(db);
  const phone = normalizeIranMobile(input.phone);
  if (!phone) throw new BookingError("BAD_PHONE", "شماره موبایل معتبر نیست");
  if (!input.serviceIds.length) throw new BookingError("NO_SERVICE", "حداقل یک خدمت انتخاب کنید");

  const services = await db.service.findMany({ where: { id: { in: input.serviceIds }, visible: true, archived: false } });
  if (services.length !== new Set(input.serviceIds).size) throw new BookingError("BAD_SERVICE", "خدمت انتخاب‌شده در دسترس نیست");
  const assigned = await db.staffService.count({ where: { staffId: input.staffId, serviceId: { in: input.serviceIds } } });
  if (assigned !== services.length) throw new BookingError("BAD_STAFF", "این تکنیسین این خدمات را انجام نمی‌دهد");

  const durationMin = services.reduce((a, x) => a + x.durationMin, 0);
  const money = calculateDeposit(
    services.map((x) => ({ priceRial: x.priceRial, depositRequired: x.depositRequired, depositRule: ruleOf(x) })),
    s.globalDeposit, s.depositRoundingRial,
  );
  const startsAt = new Date(input.startsAt), endsAt = new Date(input.startsAt + durationMin * 60_000);
  const blockedUntil = new Date(endsAt.getTime() + s.bufferMin * 60_000);
  const location = await db.location.findFirstOrThrow();

  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "StaffProfile" WHERE id = ${input.staffId} FOR UPDATE`; // serialise per technician
      await expireStaleHolds(tx, new Date(now));

      let customer = await tx.customer.findUnique({ where: { phone } });
      if (customer?.blocked) throw new BookingError("BLOCKED", "امکان ثبت نوبت برای این شماره وجود ندارد. لطفاً با سالن تماس بگیرید");
      customer ??= await tx.customer.create({ data: { phone, fullName: input.fullName, email: input.email } });

      // Re-validate the slot against the SAME engine the public calendar uses, inside the transaction.
      const local = utcToLocalYMD(input.startsAt, s.timeZone);
      const open = await slotsForStaff(tx as unknown as Db, input.staffId, local, durationMin, s, now);
      if (!open.includes(input.startsAt)) throw new BookingError("SLOT_UNAVAILABLE", "این ساعت دیگر در دسترس نیست");

      const hold = new Date(now + s.holdMinutes * 60_000);
      const booking = await tx.booking.create({
        data: {
          reference: generateBookingReference(), locationId: location.id, customerId: customer.id, staffId: input.staffId,
          status: "PENDING_PAYMENT", source: input.source ?? "ONLINE", startsAt, endsAt, blockedUntil,
          holdExpiresAt: hold, totalRial: money.totalRial, depositRequiredRial: money.depositRial,
          notes: input.notes,
          lines: { create: services.map((x) => ({ serviceId: x.id, nameSnapshot: x.name, priceRial: x.priceRial, durationMin: x.durationMin })) },
        },
      });
      await tx.auditLog.create({ data: { action: "booking.create", entity: "Booking", entityId: booking.id, after: { reference: booking.reference }, actorRole: input.actor?.kind ?? "customer" } });
      return { booking, depositRial: money.depositRial, remainingRial: money.remainingRial, holdExpiresAt: booking.holdExpiresAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (e) {
    if (isOverlapViolation(e)) throw new BookingError("SLOT_UNAVAILABLE", "این ساعت همین حالا توسط شخص دیگری رزرو شد");
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Manual deposit workflow. NOTHING here confirms a booking except approveDeposit(), which requires `payment.approve`.
// ---------------------------------------------------------------------------------------------
type Staff = Extract<Actor, { kind: "staff" }> & { userId: string; role: string };

/** Customer clicked "I have paid". Records the declaration (+ optional receipt) and moves to VERIFICATION_PENDING. */
export async function declarePayment(db: Db, i: { reference: string; phone: string; declaredAmountRial?: number; transactionRef?: string;
  evidence?: { storageKey: string; mime: string; sizeBytes: number; sha256: string } }, now = Date.now()) {
  const phone = normalizeIranMobile(i.phone);
  return db.$transaction(async (tx) => {
    const b = await tx.booking.findUnique({ where: { reference: i.reference }, include: { customer: true } });
    // same message for "not found" and "wrong phone" so references can't be probed
    if (!b || !phone || b.customer.phone !== phone) throw new BookingError("NOT_FOUND", "نوبت پیدا نشد");
    if (b.holdExpiresAt && b.holdExpiresAt.getTime() < now && b.status !== "VERIFICATION_PENDING") {
      await expireStaleHolds(tx, new Date(now));
      throw new BookingError("HOLD_EXPIRED", "مهلت نگه‌داشتن این ساعت تمام شده است. لطفاً دوباره نوبت بگیرید");
    }
    if (!i.transactionRef && !i.evidence) throw new BookingError("NEED_EVIDENCE", "شماره پیگیری یا تصویر رسید را وارد کنید");
    assertTransition(b.status, "VERIFICATION_PENDING", { actor: { kind: "customer" }, depositRequiredRial: b.depositRequiredRial, depositApprovedRial: 0 });
    const dep = await tx.depositRecord.create({ data: {
      bookingId: b.id, declaredAmountRial: i.declaredAmountRial ?? b.depositRequiredRial, transactionRef: i.transactionRef,
      evidence: i.evidence ? { create: i.evidence } : undefined } });
    await tx.booking.update({ where: { id: b.id }, data: { status: "VERIFICATION_PENDING", holdExpiresAt: null } }); // slot stays reserved while the owner checks the bank
    await tx.notification.create({ data: { title: "پرداخت بیعانه نیاز به بررسی دارد", body: `نوبت ${b.reference}`, link: `/admin/bookings/${b.id}` } });
    await tx.auditLog.create({ data: { action: "deposit.declared", entity: "Booking", entityId: b.id, actorRole: "customer", after: { depositId: dep.id } } });
    return dep;
  });
}

/** Admin checked the REAL bank account and the money arrived. */
export async function approveDeposit(db: Db, actor: Staff, depositId: string, receivedAmountRial?: number) {
  return db.$transaction(async (tx) => {
    const d = await tx.depositRecord.findUniqueOrThrow({ where: { id: depositId }, include: { booking: true } });
    if (d.decision !== "PENDING") throw new BookingError("ALREADY_DECIDED", "این پرداخت قبلاً بررسی شده است");
    const approved = receivedAmountRial ?? d.declaredAmountRial;
    assertTransition(d.booking.status, "CONFIRMED", { actor, depositRequiredRial: d.booking.depositRequiredRial, depositApprovedRial: approved });
    await tx.depositRecord.update({ where: { id: d.id }, data: { decision: "APPROVED", approvedAmountRial: approved, decidedById: actor.userId, decidedAt: new Date() } });
    await tx.paymentTransaction.create({ data: { bookingId: d.bookingId, kind: "DEPOSIT", amountRial: approved, method: "transfer", recordedById: actor.userId } });
    const b = await tx.booking.update({ where: { id: d.bookingId }, data: { status: "CONFIRMED", holdExpiresAt: null, rejectionReason: null } });
    await tx.auditLog.create({ data: { action: "deposit.approved", entity: "Booking", entityId: b.id, actorId: actor.userId, actorRole: actor.role, after: { approved } } });
    return b;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function rejectDeposit(db: Db, actor: Staff, depositId: string, reason: string, now = Date.now()) {
  const s = await loadBookingSettings(db);
  return db.$transaction(async (tx) => {
    const d = await tx.depositRecord.findUniqueOrThrow({ where: { id: depositId }, include: { booking: true } });
    if (d.decision !== "PENDING") throw new BookingError("ALREADY_DECIDED", "این پرداخت قبلاً بررسی شده است");
    assertTransition(d.booking.status, "PAYMENT_REJECTED", { actor, depositRequiredRial: d.booking.depositRequiredRial, depositApprovedRial: 0 });
    await tx.depositRecord.update({ where: { id: d.id }, data: { decision: "REJECTED", decidedById: actor.userId, decidedAt: new Date(), decisionReason: reason } });
    // give the customer a grace window to send better evidence; afterwards expireStaleHolds releases the slot
    const b = await tx.booking.update({ where: { id: d.bookingId }, data: { status: "PAYMENT_REJECTED", rejectionReason: reason, holdExpiresAt: new Date(now + s.rejectedGraceMinutes * 60_000) } });
    await tx.auditLog.create({ data: { action: "deposit.rejected", entity: "Booking", entityId: b.id, actorId: actor.userId, actorRole: actor.role, after: { reason } } });
    return b;
  });
}
export async function recordBalancePayment(db: Db, actor: Staff, bookingId: string, amountRial: number, method: string) {
  if (!Number.isSafeInteger(amountRial) || amountRial <= 0) throw new BookingError("BAD_AMOUNT", "مبلغ نامعتبر است");
  return db.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { transactions: true } });
    const paid = b.transactions.filter((t) => t.kind !== "REFUND").reduce((a, t) => a + t.amountRial, 0);
    if (paid + amountRial > b.totalRial) throw new BookingError("OVERPAY", "مبلغ از باقی‌مانده بیشتر است");
    await tx.paymentTransaction.create({ data: { bookingId, kind: "BALANCE", amountRial, method, recordedById: actor.userId } });
    await tx.auditLog.create({ data: { action: "balance.recorded", entity: "Booking", entityId: bookingId, actorId: actor.userId, actorRole: actor.role, after: { amountRial, method } } });
  });
}
/** Records a refund the admin made OUTSIDE the system. Never moves money. Capped at what was actually received. */
export async function recordRefund(db: Db, actor: Staff, bookingId: string, amountRial: number, reason: string) {
  return db.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { transactions: true, refunds: true } });
    const received = b.transactions.filter((t) => t.kind !== "REFUND").reduce((a, t) => a + t.amountRial, 0);
    const refunded = b.refunds.reduce((a, r) => a + r.amountRial, 0);
    if (!Number.isSafeInteger(amountRial) || amountRial <= 0 || refunded + amountRial > received) throw new BookingError("BAD_REFUND", "مبلغ بازپرداخت نامعتبر است");
    await tx.refundRecord.create({ data: { bookingId, amountRial, reason, recordedById: actor.userId } });
    await tx.paymentTransaction.create({ data: { bookingId, kind: "REFUND", amountRial, recordedById: actor.userId, note: reason } });
    await tx.auditLog.create({ data: { action: "refund.recorded", entity: "Booking", entityId: bookingId, actorId: actor.userId, actorRole: actor.role, after: { amountRial, reason } } });
  });
}
/** Cancels and returns what the policy says is refundable (advice only; an admin records any refund). */
export async function cancelBooking(db: Db, actor: Actor, bookingId: string, reason: string, now = Date.now()) {
  const s = await loadBookingSettings(db);
  return db.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { deposits: true } });
    assertTransition(b.status, "CANCELLED", { actor, depositRequiredRial: b.depositRequiredRial, depositApprovedRial: 0 });
    const paid = b.deposits.filter((d) => d.decision === "APPROVED").reduce((a, d) => a + d.approvedAmountRial, 0);
    const policy = evaluateCancellation(b.startsAt.getTime(), now, paid, s.cancellation);
    await tx.booking.update({ where: { id: bookingId }, data: { status: "CANCELLED", cancelledAt: new Date(now), cancelReason: reason } });
    await tx.auditLog.create({ data: { action: "booking.cancel", entity: "Booking", entityId: bookingId, actorRole: actor.kind, after: { reason, ...policy } } });
    return policy;
  });
}
