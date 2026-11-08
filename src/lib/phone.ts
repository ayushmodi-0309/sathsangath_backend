import { ALL_COUNTRIES } from "./countries-data";

/**
 * Mobile-number rules per supported country. The website form shows the same list
 * (frontend/lib/geo.ts); this file is the authoritative check.
 *
 * Stored format: India keeps the plain 10-digit number (existing data and logins);
 * every other country is stored as +<dialcode><national number>.
 */
/** ISO 3166 alpha-2 code, e.g. "IN". Every country in the world is accepted. */
export type CountryCode = string;

type Rule = { name: string; dial: string; national: RegExp; stripZero: boolean; example: string };

/** Countries whose mobile numbers we check in detail. */
const STRICT: Record<string, Omit<Rule, "name" | "dial">> = {
  IN: { national: /^[6-9]\d{9}$/, stripZero: false, example: "98765 43210" },
  US: { national: /^[2-9]\d{2}[2-9]\d{6}$/, stripZero: false, example: "415 555 0132" },
  CA: { national: /^[2-9]\d{2}[2-9]\d{6}$/, stripZero: false, example: "416 555 0132" },
  GB: { national: /^7\d{9}$/, stripZero: true, example: "07400 123456" },
  AU: { national: /^4\d{8}$/, stripZero: true, example: "0412 345 678" },
  AE: { national: /^5\d{8}$/, stripZero: true, example: "050 123 4567" },
  NZ: { national: /^2\d{7,9}$/, stripZero: true, example: "021 123 4567" },
  // Uganda's national significant number is nine digits (ITU-T corrigendum for country code 256),
  // and mobiles are the ones beginning with 7 - written locally as 07 plus eight digits.
  UG: { national: /^7\d{8}$/, stripZero: true, example: "0742 920869" },
};
/** Any other country: 6 to 14 digits after the dial code (a leading 0, customary at home, is dropped). */
const GENERIC = { national: /^[1-9]\d{5,13}$/, stripZero: true, example: "" };

export const PHONE_RULES: Record<string, Rule> = Object.fromEntries(
  ALL_COUNTRIES.map(([code, name, dial]) => [code, { name, dial, ...(STRICT[code] ?? GENERIC) }]),
);
const FIRST = ["IN", "US", "GB", "CA", "AU", "AE", "NZ", "UG"]; // the ones our families live in come first, so +1 resolves to the US before Canada
export const COUNTRY_CODES: string[] = [...FIRST, ...Object.keys(PHONE_RULES).filter((c) => !FIRST.includes(c))];
export const isCountry = (c: unknown): c is CountryCode => typeof c === "string" && Object.prototype.hasOwnProperty.call(PHONE_RULES, c);

export type PhoneResult = { ok: true; value: string; country: CountryCode } | { ok: false; error: string };

/**
 * A stand-in for a member whose real mobile is missing from their bio data, or so contradictory
 * that storing it would be worse than storing nothing. Phone is required and unique, so these
 * members could not otherwise be created at all.
 *
 * Six leading zeros then a counter, e.g. 0000000001. No real number in any supported country can
 * look like this, since every national rule requires a non-zero first digit. They are distinct so
 * the unique column is satisfied, and they share a prefix so one admin search for "000000" lists
 * every member still waiting for a real number.
 */
export const PLACEHOLDER_PHONE_RE = /^0{6}\d{4}$/;
export const isPlaceholderPhone = (raw: string) => PLACEHOLDER_PHONE_RE.test(raw.replace(/\D/g, ""));

/** Validates `raw` for `country` (digits, spaces, dashes and a leading +dialcode are all accepted). */
export function checkPhone(raw: string, country: CountryCode): PhoneResult {
  // Checked before the country rules, and returned verbatim rather than given a dial code, so the
  // stored value stays searchable as plain zeros. Deliberately also ahead of the PHONE_RULES
  // lookup, so a placeholder works even for a country this build does not know.
  const asTyped = raw.replace(/\D/g, "");
  if (isPlaceholderPhone(asTyped)) return { ok: true, value: asTyped, country };
  const rule = PHONE_RULES[country];
  const hasPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (hasPlus && digits.startsWith(rule.dial)) digits = digits.slice(rule.dial.length);
  else if (!hasPlus && country === "IN" && digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (rule.stripZero) digits = digits.replace(/^0/, "");
  if (!rule.national.test(digits)) return { ok: false, error: `Enter a valid ${rule.name} mobile number${rule.example ? ` (for example ${rule.example})` : ""}` };
  return { ok: true, value: country === "IN" ? digits : `+${rule.dial}${digits}`, country };
}

/** For free-form numbers without a chosen country (login, profile edit): infers it from a +dialcode, else India. */
export function checkAnyPhone(raw: string): PhoneResult {
  const t = raw.trim();
  if (t.startsWith("+")) {
    const digits = t.replace(/\D/g, "");
    const match = COUNTRY_CODES.filter((c) => digits.startsWith(PHONE_RULES[c].dial)).sort((a, b) => PHONE_RULES[b].dial.length - PHONE_RULES[a].dial.length);
    for (const c of match) { const r = checkPhone(t, c); if (r.ok) return r; }
    return { ok: false, error: "Enter a valid mobile number with its country code, for example +91 98765 43210" };
  }
  return checkPhone(t, "IN");
}
