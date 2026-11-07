// UNEXECUTED. Creates the first Owner + clearly-labelled DEMO data. Everything is editable later in the dashboard.
import { PrismaClient } from "@prisma/client";
import { hashPassword, validatePasswordStrength } from "../src/lib/security.ts";
import { BOOKING_DEFAULTS } from "../src/server/settings.ts";

const db = new PrismaClient();
const pw = process.env.SEED_OWNER_PASSWORD ?? "";
const email = (process.env.SEED_OWNER_EMAIL ?? "").toLowerCase();
if (!email || validatePasswordStrength(pw)) { console.error("Set SEED_OWNER_EMAIL and a strong SEED_OWNER_PASSWORD in .env"); process.exit(1); }

const loc = (await db.location.findFirst()) ?? (await db.location.create({ data: { name: "شعبه اصلی", city: "شاهین‌شهر", province: "اصفهان" } }));
const owner = await db.user.upsert({ where: { email }, update: {}, create: { role: "OWNER", email, fullName: "نازنین حیدری", passwordHash: await hashPassword(pw) } });

const settings: Record<string, unknown> = {
  "salon.name": "نام سالن (نمونه – از پنل ویرایش کنید)",          // public business name: SEPARATE from the owner's name
  "owner.displayName": "نازنین حیدری",
  "salon.description": "متن نمونه معرفی سالن",
  ...Object.fromEntries(Object.entries(BOOKING_DEFAULTS).map(([k, v]) => [`booking.${k}`, v])),
};
for (const [key, value] of Object.entries(settings)) await db.setting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });

// Iran week: 0=Saturday..6=Friday. Demo hours: Saturday–Thursday 09:00–19:00, Friday closed.
if ((await db.businessHours.count()) === 0)
  await db.businessHours.createMany({ data: [0, 1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMin: 9 * 60, endMin: 19 * 60 })) });

if ((await db.serviceCategory.count()) === 0) {
  const cat = await db.serviceCategory.create({ data: { name: "[نمونه] ناخن", slug: "nails" } });
  const mk = (name: string, slug: string, priceToman: number, durationMin: number) =>
    db.service.create({ data: { categoryId: cat.id, name: `[نمونه] ${name}`, slug, priceRial: priceToman * 10, durationMin } });
  const svc = [await mk("مانیکور", "manicure", 300_000, 45), await mk("کاشت ناخن", "extensions", 900_000, 120)];
  const tech = await db.user.create({ data: { role: "STAFF", email: `tech.demo.${Date.now()}@example.invalid`, fullName: "[نمونه] تکنیسین" } });
  const sp = await db.staffProfile.create({ data: { userId: tech.id, locationId: loc.id, displayName: "[نمونه] تکنیسین", bio: "پروفایل نمونه" } });
  await db.staffService.createMany({ data: svc.map((s) => ({ staffId: sp.id, serviceId: s.id })) });
  await db.workingSchedule.createMany({ data: [0, 1, 2, 3, 4, 5].map((weekday) => ({ staffId: sp.id, weekday, startMin: 10 * 60, endMin: 18 * 60 })) });
  await db.staffBreak.createMany({ data: [0, 1, 2, 3, 4, 5].map((weekday) => ({ staffId: sp.id, weekday, startMin: 13 * 60, endMin: 14 * 60 })) });
}
console.log("Seed complete. Owner:", owner.email, "| Enable 2FA after first login.");
await db.$disconnect();
