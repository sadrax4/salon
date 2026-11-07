import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { requireStaff, assertSameOrigin } from "@/server/auth";
import { rejectDeposit } from "@/server/booking-service";
import { handle } from "@/server/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await assertSameOrigin();
    const actor = await requireStaff("payment.approve");
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(await req.json());
    const b = await rejectDeposit(db, actor, (await ctx.params).id, reason);
    return NextResponse.json({ status: b.status });
  } catch (e) { return handle(e); }
}
