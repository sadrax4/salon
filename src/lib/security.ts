/** Dependency-free security primitives built on node:crypto. */
import { randomBytes, randomInt, scrypt as _scrypt, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, o: object) => Promise<Buffer>;

const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;
export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return "رمز عبور باید حداقل ۱۰ نویسه باشد";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "رمز عبور باید شامل حروف و عدد باشد";
  return null;
}
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${h.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, s, h] = stored.split("$");
  if (alg !== "scrypt" || !h) return false;
  const expected = Buffer.from(h, "base64");
  const got = await scrypt(pw.normalize("NFKC"), Buffer.from(s, "base64"), expected.length, { N: +n, r: +r, p: +p, maxmem: 128 * +n * +r * 2 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Session/reset tokens: random 32 bytes; only the SHA-256 hash is stored in the DB. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Human-friendly booking reference, e.g. NS-7K3M9Q (no 0/O/1/I/L). */
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function generateBookingReference(prefix = "NS", len = 6): string {
  let s = "";
  for (let i = 0; i < len; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `${prefix}-${s}`;
}

// ---------- TOTP (RFC 6238) for Owner 2FA ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, val = 0; const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(c); if (i < 0) throw new Error("Invalid base32");
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const generateTotpSecret = () => base32Encode(randomBytes(20));
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}
export function totp(secretB32: string, atMs = Date.now(), digits = 6, stepSec = 30): string {
  return hotp(base32Decode(secretB32), Math.floor(atMs / 1000 / stepSec), digits);
}
export function verifyTotp(secretB32: string, code: string, atMs = Date.now(), window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const c = Math.floor(atMs / 30000);
  for (let w = -window; w <= window; w++) {
    const exp = Buffer.from(hotp(base32Decode(secretB32), c + w)); const got = Buffer.from(code);
    if (timingSafeEqual(exp, got)) return true;
  }
  return false;
}
export const otpauthUrl = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

// ---------- AES-256-GCM for payment details at rest ----------
import { createCipheriv, createDecipheriv } from "node:crypto";
export function encryptSecret(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64"); if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes (base64)");
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function decryptSecret(blob: string, keyB64: string): string {
  const [iv, tag, enc] = blob.split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---------- Login rate limiting / lockout (in-memory; swap for Redis if you scale out) ----------
export class AttemptLimiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max = 5, windowMs = 15 * 60_000) { this.max = max; this.windowMs = windowMs; }
  /** records an attempt; returns false when the key is currently blocked */
  attempt(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(now); this.hits.set(key, arr); return true;
  }
  reset(key: string) { this.hits.delete(key); }
}

// ---------- Receipt upload validation (content sniffing, never trust client MIME) ----------
export type ReceiptCheck = { ok: true; mime: string; ext: string } | { ok: false; reason: string };
export function validateReceiptFile(bytes: Uint8Array, maxBytes = 5 * 1024 * 1024): ReceiptCheck {
  if (bytes.length === 0) return { ok: false, reason: "EMPTY" };
  if (bytes.length > maxBytes) return { ok: false, reason: "TOO_LARGE" };
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ok: true, mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { ok: true, mime: "image/png", ext: "png" };
  const ascii = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { ok: true, mime: "image/webp", ext: "webp" };
  return { ok: false, reason: "UNSUPPORTED_TYPE" };
}
