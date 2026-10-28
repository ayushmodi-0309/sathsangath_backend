import { prisma } from "./db";

/**
 * The form fields that are backed by an admin-managed tag list, and the category each one feeds.
 *
 * Every one of these is rendered as a Combobox with `allowCustom`, so a member or an admin can
 * type a value that is not on the list yet ("Use what I typed"). These lists are therefore meant
 * to grow out of real bio data rather than being a fixed set the admin has to guess up front.
 *
 * Fixed-choice fields (marital status, diet, family type, income band) are deliberately absent:
 * their options are hard-coded in the forms, not admin-managed.
 */
export const TAG_FIELD_CATEGORIES = {
  community: "Community",
  subCommunity: "Sub-community",
  city: "City",
  education: "Education",
  profession: "Profession",
  motherTongue: "Mother tongue",
  birthPlace: "Birth Place",
} as const;

export type TagBackedField = keyof typeof TAG_FIELD_CATEGORIES;
const FIELDS = Object.keys(TAG_FIELD_CATEGORIES) as TagBackedField[];
const MAX_VALUE_LEN = 100;

type Fields = Partial<Record<TagBackedField, string | null>>;

/** Finds a category by name, creating it the first time a value needs it. */
async function categoryId(name: string): Promise<string> {
  const existing = await prisma.tagCategory.findUnique({ where: { name }, select: { id: true } });
  if (existing) return existing.id;
  try {
    const made = await prisma.tagCategory.create({ data: { name }, select: { id: true } });
    return made.id;
  } catch {
    // Another request created it between the lookup and the insert.
    const now = await prisma.tagCategory.findUnique({ where: { name }, select: { id: true } });
    if (!now) throw new Error(`could not create tag category "${name}"`);
    return now.id;
  }
}

/**
 * Files every tag-backed value a member supplied into its category, so the next person filling in
 * the form finds it in the dropdown instead of having to type it again.
 *
 * Matching is case-insensitive: typing "vaishnav" when "Vaishnav" is already on the list reuses
 * the existing spelling rather than adding a near-duplicate. It only ever folds differences in
 * case and surrounding space — it does not try to correct spelling, so "Jayswal" and "Jaiswal"
 * remain separate values for the admin to merge by hand in Settings.
 *
 * Returns the canonical value for each field that needs correcting, so the caller can store the
 * list's spelling on the member row rather than the variant that was typed.
 */
export async function learnTagValues(fields: Fields): Promise<Partial<Record<TagBackedField, string>>> {
  const corrections: Partial<Record<TagBackedField, string>> = {};

  for (const field of FIELDS) {
    const raw = fields[field];
    if (typeof raw !== "string") continue;
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value || value.length > MAX_VALUE_LEN) continue;

    const name = TAG_FIELD_CATEGORIES[field];
    const id = await categoryId(name);
    const match = await prisma.tagValue.findFirst({
      where: { categoryId: id, value: { equals: value, mode: "insensitive" } },
      select: { value: true },
    });

    if (match) {
      if (match.value !== raw) corrections[field] = match.value;
      continue;
    }
    // New to the list: add it as typed, and store the tidied form on the member.
    await prisma.tagValue.create({ data: { categoryId: id, value } });
    if (value !== raw) corrections[field] = value;
  }

  return corrections;
}

/**
 * Wrapper for the write paths: learns the values, then corrects the member row to the list's
 * spelling. Never throws and never rejects — a bio data submission or an admin edit must not fail
 * because the tag list could not be updated.
 */
export async function learnTagValuesFor(memberId: string, fields: Fields): Promise<void> {
  try {
    const corrections = await learnTagValues(fields);
    if (Object.keys(corrections).length) await prisma.member.update({ where: { id: memberId }, data: corrections });
  } catch (e) {
    console.error("learnTagValues failed for member", memberId, e);
  }
}
