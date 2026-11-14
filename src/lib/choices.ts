/**
 * Fixed value lists the whole API shares.
 *
 * They live here, not in a route module, because both the intake validators
 * (routes/public.ts) and the feed filters (lib/matching.ts) need them, and a
 * lib module must not import a router. routes/public.ts re-exports them, so
 * every existing `from "./public"` import keeps working.
 *
 * Each currency has its own ordered ladder, lowest band first. A minimum
 * income is an index into ONE ladder. Bands are never converted between
 * currencies, so a band inserted anywhere but the end of its own ladder
 * changes what an existing filter in that currency means.
 *
 * INCOME_RANGES is the rupee ladder, kept under that name for callers that
 * only know the original list.
 */
export const DIETS = ["Vegetarian", "Jain vegetarian", "Eggetarian", "Non-vegetarian", "Vegan", "veg. + non-veg."] as const;

export const INCOME_CURRENCIES = ["INR", "USD", "GBP", "CAD", "AUD", "AED", "EUR", "SGD"] as const;
export type IncomeCurrency = (typeof INCOME_CURRENCIES)[number];

export const INCOME_RANGES_BY_CURRENCY = {
  INR: ["₹1–3 lakh", "₹3–5 lakh", "₹5–7 lakh", "₹7–10 lakh", "₹10–15 lakh", "₹15–20 lakh", "₹20–30 lakh", "₹30–50 lakh", "₹50 lakh–1 crore", "₹1 crore+"],
  USD: ["Under $40,000", "$40–60k", "$60–80k", "$80–100k", "$100–150k", "$150–200k", "$200–300k", "$300k+"],
  GBP: ["Under £30,000", "£30–45k", "£45–60k", "£60–80k", "£80–100k", "£100–150k", "£150–200k", "£200k+"],
  CAD: ["Under C$50,000", "C$50–70k", "C$70–90k", "C$90–120k", "C$120–160k", "C$160–220k", "C$220k+"],
  AUD: ["Under A$50,000", "A$50–70k", "A$70–90k", "A$90–120k", "A$120–160k", "A$160–220k", "A$220k+"],
  AED: ["Under AED 80,000", "AED 80–120k", "AED 120–180k", "AED 180–250k", "AED 250–350k", "AED 350–500k", "AED 500k+"],
  EUR: ["Under €30,000", "€30–45k", "€45–60k", "€60–80k", "€80–100k", "€100–150k", "€150–200k", "€200k+"],
  SGD: ["Under S$40,000", "S$40–60k", "S$60–90k", "S$90–120k", "S$120–180k", "S$180–250k", "S$250k+"],
} as const;

export const INCOME_RANGES = INCOME_RANGES_BY_CURRENCY.INR;

export function isIncomeCurrency(v: string): v is IncomeCurrency {
  return (INCOME_CURRENCIES as readonly string[]).includes(v);
}

export function isIncomeBand(currency: string, band: string): boolean {
  const code = currency.trim().toUpperCase();
  if (!isIncomeCurrency(code)) return false;
  return (INCOME_RANGES_BY_CURRENCY[code] as readonly string[]).includes(band.trim());
}

/**
 * The bands at or above `band` on that currency's ladder, or null when the
 * currency or the band is not one of ours. Nothing is converted.
 */
export function incomeAtLeast(currency: string | undefined, band: string | undefined): string[] | null {
  const code = (currency ?? "").trim().toUpperCase();
  if (!isIncomeCurrency(code)) return null;
  const bands = INCOME_RANGES_BY_CURRENCY[code];
  const i = (bands as readonly string[]).indexOf((band ?? "").trim());
  return i < 0 ? null : [...bands.slice(i)];
}

export type IncomePairResult =
  | { ok: true; band?: string | null; currency?: string }
  | { ok: false; message: string };

/**
 * What to write for one salary (or one partner minimum) and its currency.
 *
 * `band === undefined` means the request did not mention it. `null` clears it.
 * A missing currency keeps the stored one, except a rupee band sent on its own
 * is stored as INR. A new currency whose band is not on that ladder is refused.
 * An unchanged off-list band is left as it is, so a value saved before the
 * ladders existed can still be re-saved.
 */
export function resolveIncomePair(input: {
  band: string | null | undefined;
  currency: string | undefined;
  currentBand: string | null | undefined;
  currentCurrency: string | null | undefined;
}): IncomePairResult {
  const storedCurrency = isIncomeCurrency((input.currentCurrency ?? "").trim().toUpperCase())
    ? (input.currentCurrency ?? "").trim().toUpperCase() as IncomeCurrency
    : "INR";
  if (input.band === undefined && input.currency === undefined) return { ok: true };

  let nextCurrency: IncomeCurrency;
  if (input.currency !== undefined) {
    const code = input.currency.trim().toUpperCase();
    if (!isIncomeCurrency(code)) return { ok: false, message: "Choose a currency from the list" };
    nextCurrency = code;
  } else if (typeof input.band === "string" && input.band && isIncomeBand("INR", input.band) && !isIncomeBand(storedCurrency, input.band)) {
    nextCurrency = "INR";
  } else {
    nextCurrency = storedCurrency;
  }

  const nextBand = input.band === undefined ? (input.currentBand ?? null) : input.band;
  const unchanged = nextBand === (input.currentBand ?? null) && nextCurrency === storedCurrency;
  if (nextBand && !isIncomeBand(nextCurrency, nextBand) && !unchanged) {
    return { ok: false, message: "Choose an annual income range from the list" };
  }

  return {
    ok: true,
    band: input.band === undefined ? undefined : input.band,
    currency: input.currency !== undefined || nextCurrency !== storedCurrency ? nextCurrency : undefined,
  };
}

/** Apply the member's own salary and the partner minimum, which are independent. */
export function incomeFieldsPatch(
  input: {
    income?: string | null;
    incomeCurrency?: string;
    prefIncomeMin?: string | null;
    prefIncomeCurrency?: string;
  },
  current: {
    income: string | null;
    incomeCurrency: string | null;
    prefIncomeMin: string | null;
    prefIncomeCurrency: string | null;
  },
): { ok: true; patch: { income?: string | null; incomeCurrency?: string; prefIncomeMin?: string | null; prefIncomeCurrency?: string } } | { ok: false; field: "income" | "prefIncomeMin"; message: string } {
  const own = resolveIncomePair({
    band: input.income, currency: input.incomeCurrency,
    currentBand: current.income, currentCurrency: current.incomeCurrency,
  });
  if (!own.ok) return { ok: false, field: "income", message: own.message };
  const pref = resolveIncomePair({
    band: input.prefIncomeMin, currency: input.prefIncomeCurrency,
    currentBand: current.prefIncomeMin, currentCurrency: current.prefIncomeCurrency,
  });
  if (!pref.ok) return { ok: false, field: "prefIncomeMin", message: pref.message === "Choose an annual income range from the list" ? "Choose a minimum income from the list" : pref.message };
  const patch: { income?: string | null; incomeCurrency?: string; prefIncomeMin?: string | null; prefIncomeCurrency?: string } = {};
  if (own.band !== undefined) patch.income = own.band;
  if (own.currency !== undefined) patch.incomeCurrency = own.currency;
  if (pref.band !== undefined) patch.prefIncomeMin = pref.band;
  if (pref.currency !== undefined) patch.prefIncomeCurrency = pref.currency;
  return { ok: true, patch };
}
