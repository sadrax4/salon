import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { loadBookingSettings } from "@/server/settings";
import { slotsForStaff } from "@/server/availability";
import { handle } from "@/server/http";

const q = z.object({ staffId: z.string().min(1), serviceIds: z.string().min(1), y: z.coerce.number().int(), m: z.coerce.number().int().min(1).max(12), d: z.coerce.number().int().min(1).max(31) });
/** Public. Returns ONLY start times: no prices, no durations. */
export async function GET(req: NextRequest) {
  try {
    const p = q.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ids = p.serviceIds.split(",");
    const s = await loadBookingSettings(db);
    const services = await db.service.findMany({ where: { id: { in: ids }, visible: true, archived: false } });
    if (services.length !== ids.length) return NextResponse.json({ slots: [] });
    const slots = await slotsForStaff(db, p.staffId, { y: p.y, m: p.m, d: p.d }, services.reduce((a, x) => a + x.durationMin, 0), s);
    return NextResponse.json({ slots: slots.map((t) => new Date(t).toISOString()) });
  } catch (e) { return handle(e); }
}
