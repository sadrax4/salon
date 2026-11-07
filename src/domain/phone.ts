import { toLatinDigits } from "./money.ts";

/** Normalize an Iranian MOBILE number to canonical "09xxxxxxxxx". Returns null if invalid. */
export function normalizeIranMobile(input: string): string | null {
  let s = toLatinDigits(input).replace(/[\s\-().‌]/g, "");
  if (s.startsWith("+98")) s = s.slice(3);
  else if (s.startsWith("0098")) s = s.slice(4);
  else if (s.startsWith("98") && s.length === 12) s = s.slice(2);
  else if (s.startsWith("0")) s = s.slice(1);
  return /^9\d{9}$/.test(s) ? "0" + s : null;
}

export const toE164 = (canonical: string) => "+98" + canonical.slice(1);

/** "09123456789" -> "۰۹۱۲ ۳۴۵ ۶۷۸۹" */
export function formatIranMobile(canonical: string): string {
  const g = `${canonical.slice(0, 4)} ${canonical.slice(4, 7)} ${canonical.slice(7)}`;
  return g.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}
