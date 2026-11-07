-- Applied AFTER the Prisma init migration (npm run db:setup). Prisma cannot express these.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Database-level double-booking guarantee: one technician cannot have two slot-occupying
-- bookings whose [startsAt, blockedUntil) ranges overlap. Expired/cancelled/completed rows are excluded.
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS booking_no_overlap;
ALTER TABLE "Booking" ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist ("staffId" WITH =, tstzrange("startsAt", "blockedUntil", '[)') WITH &&)
  WHERE (status IN ('PENDING_PAYMENT','VERIFICATION_PENDING','PAYMENT_REJECTED','CONFIRMED'));

ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS booking_time_order;
ALTER TABLE "Booking" ADD CONSTRAINT booking_time_order CHECK ("endsAt" > "startsAt" AND "blockedUntil" >= "endsAt");
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS booking_money_nonneg;
ALTER TABLE "Booking" ADD CONSTRAINT booking_money_nonneg CHECK ("totalRial" >= 0 AND "discountRial" >= 0 AND "depositRequiredRial" >= 0 AND "depositRequiredRial" <= "totalRial");
ALTER TABLE "PaymentTransaction" DROP CONSTRAINT IF EXISTS tx_positive;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT tx_positive CHECK ("amountRial" > 0);
ALTER TABLE "RefundRecord" DROP CONSTRAINT IF EXISTS refund_positive;
ALTER TABLE "RefundRecord" ADD CONSTRAINT refund_positive CHECK ("amountRial" > 0);
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS review_rating;
ALTER TABLE "Review" ADD CONSTRAINT review_rating CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "WorkingSchedule" DROP CONSTRAINT IF EXISTS ws_valid;
ALTER TABLE "WorkingSchedule" ADD CONSTRAINT ws_valid CHECK (weekday BETWEEN 0 AND 6 AND "startMin" >= 0 AND "endMin" <= 1440 AND "endMin" > "startMin");
ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS svc_valid;
ALTER TABLE "Service" ADD CONSTRAINT svc_valid CHECK ("priceRial" >= 0 AND "durationMin" > 0);
