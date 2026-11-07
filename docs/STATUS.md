# Project status (honest)

Authored in a sandbox with **no network, no Postgres, no Docker**. Therefore:

## Verified by execution (23 passing tests, `npm test`, see TEST-RESULTS.txt)
Money (Rial/Toman, basis points, BigInt-exact), deposit calculation, Iranian phone normalisation, Jalali⇄Gregorian
conversion (anchors + 2,900-date round trip), Tehran timezone handling, the availability engine (hours intersection,
breaks, closures, buffers, min/max advance, daily cap), the booking state machine (customer/system can never confirm;
approval needs `payment.approve` and a covering approved amount), payment-status derivation, cancellation policy,
permissions (owner-only keys cannot be delegated), password hashing, TOTP (RFC 6238 vectors), rate limiting,
receipt content-sniffing, AES-GCM encryption of payment details.

## Written but NEVER EXECUTED (expect first-run fixes)
Prisma schema + `constraints.sql` (exclusion constraint), booking/payment services, auth, API routes, seed, Next.js shell.
First commands to run: `npm install` → `npm run typecheck` → `npm run db:setup` → `npm run db:seed` → `npm run dev`.
Then write DB integration tests (`tests/db/`) for: concurrent booking of one slot (exactly one wins), hold expiry,
approve/reject, refund caps. These are the most important tests still missing.

## NOT BUILT YET
Public pages other than Home/404 (about, services list/detail, team, gallery, reviews, contact+map, FAQ, policies),
the multi-step booking UI, customer accounts/OTP login + portal, Owner dashboard UI, Staff dashboard UI, admin CRUD
screens, notification center UI, reminder scheduler (24h/2h), waitlist, recurring bookings, loyalty/referrals/discount
codes, reports & CSV/Excel export/import, SEO (sitemap/robots/schema), PWA, backup scripts, deployment guide,
dark mode, Persian date-picker component. Schema tables for most of these already exist.

## Needs external accounts (not faked)
Iranian SMS provider (adapter slot ready, mock default), map tiles/API for the contact page, optional Google
Analytics/Calendar. Stripe/online gateway intentionally excluded.
