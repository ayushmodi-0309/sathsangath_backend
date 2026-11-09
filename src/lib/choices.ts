/**
 * Fixed value lists the whole API shares.
 *
 * They live here, not in a route module, because both the intake validators
 * (routes/public.ts) and the feed filters (lib/matching.ts) need them, and a
 * lib module must not import a router. routes/public.ts re-exports them, so
 * every existing `from "./public"` import keeps working.
 *
 * INCOME_RANGES is ORDERED, lowest band first: the member-facing
 * "minimum income" filter is an index into it, so a band inserted anywhere but
 * the end changes what an existing filter means.
 */
export const DIETS = ["Vegetarian", "Jain vegetarian", "Eggetarian", "Non-vegetarian", "Vegan", "veg. + non-veg."] as const;
export const INCOME_RANGES = ["₹1–3 lakh", "₹3–5 lakh", "₹5–7 lakh", "₹7–10 lakh", "₹10–15 lakh", "₹15–20 lakh", "₹20–30 lakh", "₹30–50 lakh", "₹50 lakh–1 crore", "₹1 crore+"] as const;

/** The bands at or above `band`, or null when `band` is not one of ours. */
export function incomeAtLeast(band?: string): string[] | null {
  const i = INCOME_RANGES.indexOf((band ?? "").trim() as (typeof INCOME_RANGES)[number]);
  return i < 0 ? null : INCOME_RANGES.slice(i);
}
