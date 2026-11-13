/**
 * The canonical "profession" list.
 *
 * A mirror of `sathsangath_frontend/lib/profession.ts` — separate repositories, so the values are
 * duplicated rather than imported, and must stay identical. This copy seeds the Profession tag
 * category and decides whether a submitted value is on the list.
 *
 * Flat, unlike education: these 22 values are already the granularity the feed filters want, so a
 * dentist and a physician both pick "Doctor / Medical" instead of becoming two filter chips.
 */

/** The residual. Always last, and never offered as a filter facet. */
export const PROFESSION_OTHER = "Other";

export const PROFESSIONS: string[] = [
  "Doctor / Medical",
  "Engineer",
  "IT / Software",
  "Business / Entrepreneur",
  "Government Job",
  "Private Job",
  "Banking / Finance / CA",
  "Education / Teaching",
  "Lawyer / Legal",
  "Management / Administration",
  "Marketing / Sales / HR",
  "Police / Defence",
  "Aviation / Hospitality",
  "Media / Designing",
  "Agriculture / Farming",
  "Self Employed / Freelancer",
  "Family Business",
  "Student",
  "Homemaker",
  "Not Working",
  "Retired",
  PROFESSION_OTHER,
];

/** The filter facets: everything but the residual. */
export const PROFESSION_FACETS: string[] = PROFESSIONS.filter((p) => p !== PROFESSION_OTHER);

const BY_VALUE = new Map(PROFESSIONS.map((p) => [p.toLowerCase(), p]));

/** Looks a stored value up, case-insensitively. Returns null for anything off-list. */
export const professionEntry = (value?: string | null) =>
  value ? BY_VALUE.get(value.trim().replace(/\s+/g, " ").toLowerCase()) ?? null : null;
