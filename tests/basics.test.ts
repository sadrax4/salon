import { test } from "node:test";
import assert from "node:assert/strict";
import { formatToman, percentOf, tomanToRial, rialToToman, toLatinDigits, roundUpTo } from "../src/domain/money.ts";
import { calculateDeposit } from "../src/domain/deposit.ts";
import { normalizeIranMobile, toE164 } from "../src/domain/phone.ts";
import { gregorianToJalali, jalaliToGregorian, jalaliMonthLength, isJalaliLeap, formatJalali } from "../src/domain/jalali.ts";

test("money: toman/rial conversion and formatting", () => {
  assert.equal(tomanToRial(1000), 10000);
  assert.equal(rialToToman(10009), 1000);
  assert.equal(formatToman(12_500_000), "۱٬۲۵۰٬۰۰۰ تومان");
  assert.equal(toLatinDigits("۰۹۱۲٣"), "09123");
  assert.throws(() => percentOf(100, 10001));
  assert.throws(() => tomanToRial(1.5));
});
test("money: percent is exact and half-up, no float drift", () => {
  assert.equal(percentOf(1_000_000, 3000), 300_000);
  assert.equal(percentOf(15, 3000), 5);   // 4.5 -> 5
  assert.equal(percentOf(14, 3000), 4);   // 4.2 -> 4
  assert.equal(percentOf(Number.MAX_SAFE_INTEGER, 10000), Number.MAX_SAFE_INTEGER);
  assert.equal(roundUpTo(1234, 1000), 2000);
});
test("deposit: default 30%, per-service override, fixed, not-required, cap", () => {
  const d = calculateDeposit([{ priceRial: 10_000_000 }, { priceRial: 5_000_000 }]);
  assert.deepEqual(d, { totalRial: 15_000_000, depositRial: 4_500_000, remainingRial: 10_500_000 });
  const o = calculateDeposit([
    { priceRial: 10_000_000, depositRule: { type: "FIXED", amountRial: 2_000_000 } },
    { priceRial: 5_000_000, depositRequired: false },
  ]);
  assert.equal(o.depositRial, 2_000_000);
  const capped = calculateDeposit([{ priceRial: 1_000, depositRule: { type: "FIXED", amountRial: 9_999 } }]);
  assert.equal(capped.depositRial, 1_000);
  assert.equal(capped.remainingRial, 0);
  const disc = calculateDeposit([{ priceRial: 10_000_000 }], undefined, 10, 2_000_000);
  assert.equal(disc.totalRial, 8_000_000);
  assert.equal(disc.depositRial, 2_400_000);
});
test("phone: Iranian mobile normalization", () => {
  for (const v of ["09123456789", "+989123456789", "00989123456789", "989123456789", "9123456789", "۰۹۱۲ ۳۴۵ ۶۷۸۹", "0912-345-6789"])
    assert.equal(normalizeIranMobile(v), "09123456789", v);
  for (const v of ["0212345678", "0812345678", "0912345", "abc", ""]) assert.equal(normalizeIranMobile(v), null, v);
  assert.equal(toE164("09123456789"), "+989123456789");
});
test("jalali: known anchor dates", () => {
  assert.deepEqual(gregorianToJalali(2024, 3, 20), { y: 1403, m: 1, d: 1 });
  assert.deepEqual(gregorianToJalali(2026, 11, 5), { y: 1405, m: 8, d: 14 });
  assert.deepEqual(gregorianToJalali(2025, 3, 21), { y: 1404, m: 1, d: 1 });
  assert.deepEqual(jalaliToGregorian(1405, 1, 1), { y: 2026, m: 3, d: 21 });
  assert.deepEqual(jalaliToGregorian(1403, 12, 30), { y: 2025, m: 3, d: 20 });
  assert.equal(isJalaliLeap(1403), true);
  assert.equal(isJalaliLeap(1404), false);
  assert.equal(jalaliMonthLength(1403, 12), 30);
  assert.equal(jalaliMonthLength(1404, 12), 29);
});
test("jalali: round trip across many days", () => {
  const start = Date.UTC(2000, 0, 1);
  for (let i = 0; i < 20000; i += 7) {
    const dt = new Date(start + i * 86400000);
    const g = { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    const j = gregorianToJalali(g.y, g.m, g.d);
    assert.deepEqual(jalaliToGregorian(j.y, j.m, j.d), g);
  }
  assert.equal(formatJalali({ y: 2026, m: 11, d: 5 }, true), "پنجشنبه ۱۴ آبان ۱۴۰۵");
});
