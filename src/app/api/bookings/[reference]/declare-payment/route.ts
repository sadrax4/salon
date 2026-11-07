import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";
import { declarePayment, BookingError } from "@/server/booking-service";
import { validateReceiptFile } from "@/lib/security";
import { handle } from "@/server/http";

/** multipart: phone, transactionRef?, receipt? (image). Moves booking to VERIFICATION_PENDING only; never to CONFIRMED. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ reference: string }> }) {
  try {
    const { reference } = await ctx.params;
    const f = await req.formData();
    const phone = String(f.get("phone") ?? ""), transactionRef = String(f.get("transactionRef") ?? "").trim().slice(0, 64) || undefined;
    let evidence;
    const file = f.get("receipt");
    if (file instanceof File && file.size > 0) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const v = validateReceiptFile(bytes);
      if (!v.ok) throw new BookingError("BAD_FILE", "فقط تصویر JPG، PNG یا WebP تا ۵ مگابایت مجاز است");
      const key = `${randomUUID()}.${v.ext}`; // server-generated name; client filename is discarded
      const dir = process.env.RECEIPT_STORAGE_DIR ?? "./storage/receipts";
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, key), bytes, { mode: 0o600 });
      evidence = { storageKey: key, mime: v.mime, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    await declarePayment(db, { reference, phone, transactionRef, evidence });
    return NextResponse.json({ status: "VERIFICATION_PENDING", message: "پرداخت شما ثبت شد و پس از بررسی توسط سالن، نوبت تأیید می‌شود" });
  } catch (e) { return handle(e); }
}
