/**
 * Mobile-number rules per supported country. The website form shows the same list
 * (frontend/lib/geo.ts); this file is the authoritative check.
 *
 * Stored format: India keeps the plain 10-digit number (existing data and logins);
 * every other country is stored as +<dialcode><national number>.
 */
export type CountryCode = "IN" | "US" | "GB" | "CA" | "AU" | "AE" | "NZ" | "UG";

export const PHONE_RULES: Record<CountryCode, { name: string; dial: string; national: RegExp; stripZero: boolean; example: string }> = {
  IN: { name: "India", dial: "91", national: /^[6-9]\d{9}$/, stripZero: false, example: "98765 43210" },
  US: { name: "United States", dial: "1", national: /^[2-9]\d{2}[2-9]\d{6}$/, stripZero: false, example: "415 555 0132" },
  CA: { name: "Canada", dial: "1", national: /^[2-9]\d{2}[2-9]\d{6}$/, stripZero: false, example: "416 555 0132" },
  GB: { name: "United Kingdom", dial: "44", national: /^7\d{9}$/, stripZero: true, example: "07400 123456" },
  AU: { name: "Australia", dial: "61", national: /^4\d{8}$/, stripZero: true, example: "0412 345 678" },
  AE: { name: "United Arab Emirates", dial: "971", national: /^5\d{8}$/, stripZero: true, example: "050 123 4567" },
  NZ: { name: "New Zealand", dial: "64", national: /^2\d{7,9}$/, stripZero: true, example: "021 123 4567" },
  // Uganda's national significant number is nine digits (ITU-T corrigendum for country code 256),
  // and mobiles are the ones beginning with 7 — written locally as 07 plus eight digits.
  UG: { name: "Uganda", dial: "256", national: /^7\d{8}$/, stripZero: true, example: "0742 920869" },
};
export const COUNTRY_CODES = Object.keys(PHONE_RULES) as CountryCode[];
export const isCountry = (c: unknown): c is CountryCode => typeof c === "string" && c in PHONE_RULES;

export type PhoneResult = { ok: true; value: string; country: CountryCode } | { ok: false; error: string };

/** Validates `raw` for `country` (digits, spaces, dashes and a leading +dialcode are all accepted). */
export function checkPhone(raw: string, country: CountryCode): PhoneResult {
  const rule = PHONE_RULES[country];
  const hasPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (hasPlus && digits.startsWith(rule.dial)) digits = digits.slice(rule.dial.length);
  else if (!hasPlus && country === "IN" && digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (rule.stripZero) digits = digits.replace(/^0/, "");
  if (!rule.national.test(digits)) return { ok: false, error: `Enter a valid ${rule.name} mobile number (for example ${rule.example})` };
  return { ok: true, value: country === "IN" ? digits : `+${rule.dial}${digits}`, country };
}

/** For free-form numbers without a chosen country (login, profile edit): infers it from a +dialcode, else India. */
export function checkAnyPhone(raw: string): PhoneResult {
  const t = raw.trim();
  if (t.startsWith("+")) {
    const digits = t.replace(/\D/g, "");
    const match = COUNTRY_CODES.filter((c) => digits.startsWith(PHONE_RULES[c].dial)).sort((a, b) => PHONE_RULES[b].dial.length - PHONE_RULES[a].dial.length);
    for (const c of match) { const r = checkPhone(t, c); if (r.ok) return r; }
    return { ok: false, error: "Enter a valid mobile number with a supported country code (+91, +1, +44, +61, +971, +64)" };
  }
  return checkPhone(t, "IN");
}
