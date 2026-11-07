import { cookies, headers } from "next/headers";
import type { Db } from "./db.ts";
import { db } from "./db.ts";
import { verifyPassword, verifyTotp, newToken, hashToken, AttemptLimiter, decryptSecret } from "../lib/security.ts";
import { effectivePermissions, requirePermission, type Permission, type RoleName } from "../domain/permissions.ts";

const COOKIE = "salon_session";
const limiter = new AttemptLimiter(5, 15 * 60_000);
const IDLE_MS = 30 * 60_000; // inactivity logout; make owner-configurable via Setting `security.idleMinutes`

export class AuthError extends Error { constructor(m = "UNAUTHENTICATED") { super(m); this.name = "AuthError"; } }

export async function login(d: Db, email: string, password: string, totpCode: string | undefined, ip: string) {
  const key = `${ip}|${email.toLowerCase()}`;
  if (!limiter.attempt(key)) throw new AuthError("TOO_MANY_ATTEMPTS");
  const u = await d.user.findUnique({ where: { email: email.toLowerCase() } });
  const ok = !!u && u.active && !!u.passwordHash && (!u.lockedUntil || u.lockedUntil < new Date()) && (await verifyPassword(password, u.passwordHash));
  if (!ok || !u) throw new AuthError("INVALID_CREDENTIALS"); // identical error for unknown user / wrong password
  if (u.totpEnabled) {
    const secret = decryptSecret(u.totpSecretEnc!, process.env.DATA_ENCRYPTION_KEY!);
    if (!totpCode || !verifyTotp(secret, totpCode)) throw new AuthError("TOTP_REQUIRED");
  }
  limiter.reset(key);
  const token = newToken();
  await d.session.create({ data: { tokenHash: hashToken(token), userId: u.id, expiresAt: new Date(Date.now() + 8 * 3600_000) } });
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: (process.env.APP_URL ?? "").startsWith("https:"), sameSite: "lax", path: "/", maxAge: 8 * 3600 });
}

export async function currentStaff() {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) throw new AuthError();
  const s = await db.session.findUnique({ where: { tokenHash: hashToken(t) }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || Date.now() - s.lastSeenAt.getTime() > IDLE_MS || !s.user.active || s.user.role === "CUSTOMER") throw new AuthError();
  await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
  const permissions = effectivePermissions(s.user.role as RoleName, s.user.permissionGrants as Permission[], s.user.permissionRevokes as Permission[]);
  return { kind: "staff" as const, userId: s.user.id, role: s.user.role, permissions };
}
/** Every admin route handler starts with this. UI hiding is cosmetic; THIS is the enforcement. */
export async function requireStaff(p: Permission) { const a = await currentStaff(); requirePermission(a.permissions, p); return a; }

/** CSRF defence for cookie-authenticated mutations: SameSite=Lax cookie + Origin must match the app origin. */
export async function assertSameOrigin() {
  const h = await headers(); const origin = h.get("origin");
  if (origin && origin !== new URL(process.env.APP_URL ?? "http://localhost:3000").origin) throw new AuthError("BAD_ORIGIN");
}
