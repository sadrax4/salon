import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "سالن ناخن", description: "رزرو آنلاین نوبت – شاهین‌شهر، اصفهان" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" data-theme="light">
      <head>
        {/* Vazirmatn: self-host the font files in /public/fonts for production (no third-party request) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
