import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { createBooking } from "@/server/booking-service";
import { handle } from "@/server/http";
import { AttemptLimiter } from "@/lib/security";

const limiter = new AttemptLimiter(10, 10 * 60_000); // anti-spam: 10 booking attempts / 10 min / IP
const body = z.object({
  serviceIds: z.array(z.string().min(1)).min(1).max(8), staffId: z.string().min(1), startsAt: z.string().datetime(),
  fullName: z.string().trim().min(2).max(80), phone: z.string().min(10).max(20), email: z.string().email().optional(), notes: z.string().max(500).optional(),
  website: z.string().max(0).optional(), // honeypot: real users leave it empty
});
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
    if (!limiter.attempt(ip)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    const b = body.parse(await req.json());
    const r = await createBooking(db, { ...b, startsAt: Date.parse(b.startsAt), source: "ONLINE" });
    // Customer sees the deposit (required by spec) but not service prices or the final total.
    return NextResponse.json({ reference: r.booking.reference, depositRial: r.depositRial, holdExpiresAt: r.holdExpiresAt, status: r.booking.status }, { status: 201 });
  } catch (e) { return handle(e); }
}
