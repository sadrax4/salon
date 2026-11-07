import Link from "next/link";
export default function NotFound() {
  return (<main className="container" style={{ padding: "6rem 1.25rem", textAlign: "center" }}><h1>صفحه پیدا نشد</h1><p>آدرس وارد شده وجود ندارد.</p><Link className="btn" href="/">بازگشت به خانه</Link></main>);
}
