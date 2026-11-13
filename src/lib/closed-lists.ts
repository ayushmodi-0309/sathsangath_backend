/**
 * Education and profession are closed lists held in code, not grown from what members type.
 *
 * Two jobs live here:
 *
 *   1. `syncClosedLists()` makes the Education and Profession tag categories hold exactly the
 *      canonical values and nothing else. `GET /public/tags` serves those categories, and the
 *      mobile app builds its pickers from that endpoint, so this is what puts the fixed lists in
 *      front of app users without shipping a new app build.
 *
 *   2. `coerceEducation()` / `coerceProfession()` decide what actually gets stored. An off-list
 *      value is folded to "Other" rather than rejected: older app builds still let people type
 *      freely, and a hard 422 would break saving for them. Folding keeps the columns clean — which
 *      matters because the feed filter facets are built from the member rows themselves, so a
 *      single free-text value stored here would reappear as a filter chip.
 *
 * The cost of folding is that the typed text is lost. That is deliberate for now: there is no
 * "other, specified" column yet. Switch to rejection once the app no longer offers free text.
 */

import { prisma } from "./db";
import { EDUCATION_OTHER, EDUCATION_VALUES, educationEntry } from "./education";
import { PROFESSION_OTHER, PROFESSIONS, professionEntry } from "./profession";

/** The tag categories these lists own, by the name used in `TagCategory.name`. */
export const CLOSED_LIST_CATEGORIES = {
  Education: EDUCATION_VALUES,
  Profession: PROFESSIONS,
} as const;

/** Letters and digits only, so punctuation cannot stand between a typed value and its entry. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A second index onto the same values, keyed on punctuation-stripped text.
 *
 * Someone on an older app build types "MBBS", not "M.B.B.S.", and that should land on the degree
 * rather than in "Other". A key shared by two different values would be ambiguous, so it is left
 * out entirely instead of guessing.
 */
function loosely(values: readonly string[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const v of values) {
    const k = norm(v);
    if (!k) continue;
    seen.set(k, seen.has(k) ? null : v); // null marks an ambiguous key
  }
  const out = new Map<string, string>();
  for (const [k, v] of seen) if (v) out.set(k, v);
  return out;
}

const EDUCATION_LOOSE = loosely(EDUCATION_VALUES);
const PROFESSION_LOOSE = loosely(PROFESSIONS);

/**
 * Folds a submitted value onto the list.
 *
 * Returns the canonical spelling for anything on the list — exactly, or ignoring punctuation, so
 * "mbbs" is stored as "M.B.B.S." — "Other" for anything genuinely off it, and null for an empty
 * value, because an unanswered field should stay unanswered rather than become "Other".
 */
export const coerceEducation = (v?: string | null): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  return educationEntry(v)?.value ?? EDUCATION_LOOSE.get(norm(v)) ?? EDUCATION_OTHER;
};

export const coerceProfession = (v?: string | null): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  return professionEntry(v) ?? PROFESSION_LOOSE.get(norm(v)) ?? PROFESSION_OTHER;
};

/** How many values had to be dropped from each loose index as ambiguous. Exported for the tests. */
export const LOOSE_INDEX_SIZES = {
  education: { values: EDUCATION_VALUES.length, indexed: EDUCATION_LOOSE.size },
  profession: { values: PROFESSIONS.length, indexed: PROFESSION_LOOSE.size },
};

/**
 * Brings one category's values in line with the code: adds what is missing, removes what is not
 * on the list any more.
 *
 * Deleting a `TagValue` cascades to the `MemberTag` rows that point at it, so a member tagged with
 * a value that has left the list loses that tag. That is the intended result — the tag described a
 * value the system no longer recognises — but it is why this logs what it removes.
 */
async function syncCategory(name: string, values: readonly string[]) {
  const category = await prisma.tagCategory.upsert({
    where: { name },
    create: { name },
    update: {},
    select: { id: true },
  });

  const existing = await prisma.tagValue.findMany({
    where: { categoryId: category.id },
    select: { id: true, value: true },
  });

  const wanted = new Set(values);
  const have = new Set(existing.map((e) => e.value));

  const stale = existing.filter((e) => !wanted.has(e.value));
  const missing = values.filter((v) => !have.has(v));

  if (stale.length) {
    await prisma.tagValue.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
  if (missing.length) {
    await prisma.tagValue.createMany({
      data: missing.map((value) => ({ categoryId: category.id, value })),
      skipDuplicates: true,
    });
  }

  return { name, removed: stale.length, added: missing.length, total: values.length };
}

/**
 * Called once on server startup. Never throws: a tag list that could not be synced must not stop
 * the API from booting.
 */
export async function syncClosedLists(): Promise<void> {
  try {
    for (const [name, values] of Object.entries(CLOSED_LIST_CATEGORIES)) {
      const r = await syncCategory(name, values);
      if (r.removed || r.added) {
        console.log(`[closed-lists] ${r.name}: +${r.added} -${r.removed}, now ${r.total} values`);
      }
    }
  } catch (e) {
    console.error("[closed-lists] sync failed", e);
  }
}
