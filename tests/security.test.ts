import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { hashPassword, verifyPassword, validatePasswordStrength, generateBookingReference, totp, verifyTotp, base32Encode, base32Decode,
  AttemptLimiter, validateReceiptFile, encryptSecret, decryptSecret, newToken, hashToken, generateTotpSecret } from "../src/lib/security.ts";

test("password: hash/verify, wrong password, unique salts, policy", async () => {
  const h = await hashPassword("Correct-Horse-9");
  assert.ok(await verifyPassword("Correct-Horse-9", h));
  assert.ok(!(await verifyPassword("correct-horse-9", h)));
  assert.notEqual(h, await hashPassword("Correct-Horse-9"));
  assert.ok(!(await verifyPassword("x", "garbage")));
  assert.ok(validatePasswordStrength("short1"));
  assert.equal(validatePasswordStrength("LongEnough123"), null);
});
test("TOTP matches RFC 6238 vector and tolerates ±1 step only", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totp(secret, 59_000), "287082");
  assert.equal(totp(secret, 1111111109_000), "081804");
  assert.ok(verifyTotp(secret, "287082", 59_000 + 30_000));
  assert.ok(!verifyTotp(secret, "287082", 59_000 + 90_000));
  assert.ok(!verifyTotp(secret, "12345", 59_000));
  assert.equal(base32Decode(secret).toString(), "12345678901234567890");
  assert.match(generateTotpSecret(), /^[A-Z2-7]{32}$/);
});
test("booking reference format and uniqueness", () => {
  const set = new Set(Array.from({ length: 500 }, () => generateBookingReference()));
  assert.ok(set.size > 495);
  for (const r of set) assert.match(r, /^NS-[2-9A-HJKMNP-Z]{6}$/);
});
test("rate limiter blocks after max and recovers after window", () => {
  const l = new AttemptLimiter(3, 1000);
  assert.ok(l.attempt("a", 0) && l.attempt("a", 1) && l.attempt("a", 2));
  assert.ok(!l.attempt("a", 3));
  assert.ok(l.attempt("b", 3));
  assert.ok(l.attempt("a", 2000));
});
test("receipt validation sniffs real content, rejects disguised files", () => {
  assert.deepEqual(validateReceiptFile(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])), { ok: true, mime: "image/jpeg", ext: "jpg" });
  assert.equal(validateReceiptFile(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])).ok, true);
  assert.equal(validateReceiptFile(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")).ok, true);
  assert.deepEqual(validateReceiptFile(Buffer.from("<script>alert(1)</script>")), { ok: false, reason: "UNSUPPORTED_TYPE" });
  assert.deepEqual(validateReceiptFile(Buffer.from("MZ\x90\x00")), { ok: false, reason: "UNSUPPORTED_TYPE" });
  assert.deepEqual(validateReceiptFile(new Uint8Array(0)), { ok: false, reason: "EMPTY" });
  assert.deepEqual(validateReceiptFile(new Uint8Array(10), 5), { ok: false, reason: "TOO_LARGE" });
});
test("AES-GCM payment secret round-trip and tamper detection", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const blob = encryptSecret("6037-9912-3456-7890", key);
  assert.ok(!blob.includes("6037"));
  assert.equal(decryptSecret(blob, key), "6037-9912-3456-7890");
  const parts = blob.split("."); parts[2] = Buffer.from("tampered!!!!!!!!!!!").toString("base64");
  assert.throws(() => decryptSecret(parts.join("."), key));
  assert.throws(() => encryptSecret("x", "c2hvcnQ="));
  assert.notEqual(hashToken(newToken()), newToken());
});
