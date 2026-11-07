import type { Db } from "./db.ts";
export interface SmsProvider { name: string; send(toE164: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> }

/** Development provider: sends NOTHING, only reports success so flows can be exercised. Everything is logged. */
export const mockSms: SmsProvider = { name: "mock", async send() { return { ok: true }; } };

/**
 * To connect an Iranian SMS gateway later: implement SmsProvider (one `send` method calling that gateway's HTTP API),
 * register it in `providers` below, put its key in .env (SMS_API_KEY) and set SMS_PROVIDER=<name>. No other code changes.
 */
const providers: Record<string, SmsProvider> = { mock: mockSms };

export async function sendSms(db: Db, to: string, template: string, body: string, bookingId?: string) {
  const name = process.env.SMS_PROVIDER ?? "mock";
  const p = providers[name];
  if (!p) {
    await db.notificationLog.create({ data: { channel: "SMS", provider: name, toAddress: to, template, body, status: "SKIPPED", error: "provider not configured", bookingId } });
    return;
  }
  const r = await p.send(to, body).catch((e) => ({ ok: false as const, error: String(e) }));
  await db.notificationLog.create({ data: { channel: "SMS", provider: p.name, toAddress: to, template, body, status: r.ok ? "SENT" : "FAILED", error: r.ok ? null : r.error, bookingId } });
}
