import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { requireStaff, assertSameOrigin } from "@/server/auth";
import { approveDeposit } from "@/server/booking-service";
import { handle } from "@/server/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await assertSameOrigin();
    const actor = await requireStaff("payment.approve");           // server-side authorization
    const { receivedAmountRial } = z.object({ receivedAmountRial: z.number().int().positive().optional() }).parse(await req.json().catch(() => ({})));
    const b = await approveDeposit(db, actor, (await ctx.params).id, receivedAmountRial);
    return NextResponse.json({ status: b.status });
  } catch (e) { return handle(e); }
}
