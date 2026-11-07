import Link from "next/link";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Public home. Services are listed WITHOUT price or duration (spec). Name/description come from owner-editable settings. */
export default async function Home() {
  const [name, desc, services] = await Promise.all([
    db.setting.findUnique({ where: { key: "salon.name" } }),
    db.setting.findUnique({ where: { key: "salon.description" } }),
    db.service.findMany({ where: { visible: true, archived: false }, select: { id: true, name: true, slug: true, description: true, imageUrl: true }, take: 6, orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <main>
      <section className="container" style={{ padding: "4rem 1.25rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "clamp(2rem,6vw,3.5rem)", margin: 0 }}>{String(name?.value ?? "سالن ناخن")}</h1>
        <p style={{ maxWidth: 560, marginInline: "auto" }}>{String(desc?.value ?? "")}</p>
        <Link className="btn" href="/booking">رزرو نوبت</Link>
        <hr className="gold-rule" />
      </section>
      <section className="container" aria-labelledby="svc">
        <h2 id="svc">خدمات</h2>
        {services.length === 0 ? <p className="card">هنوز خدمتی ثبت نشده است.</p> : (
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
            {services.map((s) => (<Link key={s.id} href={`/services/${s.slug}`} className="card" style={{ textDecoration: "none" }}><h3>{s.name}</h3><p>{s.description}</p></Link>))}
          </div>)}
      </section>
      <div className="sticky-cta"><Link className="btn" href="/booking">رزرو نوبت</Link></div>
    </main>
  );
}
