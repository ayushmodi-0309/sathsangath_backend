/**
 * Community is a closed list: the admin maintains it in Settings → Community, and members pick
 * from it. This folds whatever an API client sends onto that list.
 *
 * Resolution order for a submitted value:
 *   1. It is on the admin list (case- and spacing-insensitive)  -> the list's own spelling.
 *   2. It is in COMMUNITY_ALIASES                               -> the mapped value.
 *   3. Anything else                                            -> "Other".
 * An empty value returns null: an unanswered field stays unanswered.
 *
 * Older app builds still offer a built-in list and let people type their own, so a value that is
 * on neither list is folded to "Other" instead of rejected. A hard error would stop those builds
 * from saving. Keep COMMUNITY_ALIASES for as long as those builds are in use.
 *
 * Not wired into any route yet. The write paths are `routes/member.ts`, `routes/public.ts` and
 * `routes/admin.ts`.
 */

import { prisma } from "./db";

export const COMMUNITY_CATEGORY = "Community";
export const COMMUNITY_OTHER = "Other";

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Old value -> canonical value. Keys are matched case-insensitively with whitespace collapsed,
 * so list them in any case.
 *
 * It covers the names the older app builds and the website still offer from their built-in lists, plus
 * the spellings found in existing data. The admin list is checked first, so a name that is on the list
 * is never changed by an entry here. A target must exist on the admin list to match the filter.
 */
export const COMMUNITY_ALIASES: Record<string, string> = {
  "Aanjana patel": "Patel / Patidar",
  "Agarwal": "Agarwal",
  "Aggarwal": "Agarwal",
  "Agrawal": "Agarwal",
  "Ahir": "Ahir / Yadav",
  "Anavil Brahmin": "Brahmin",
  "Anjana Chaudhari Patel": "Patel / Patidar",
  "Arora": "Arora",
  "Audichya Brahmin": "Brahmin",
  "Baniya": "Baniya",
  "Bengali Brahmin": "Brahmin",
  "Bengali Kayastha": "Kayastha",
  "Bharwad": "Bharwad",
  "Bhatia": "Bhatia",
  "Bhavsar": "Bhavsar",
  "Bhramin all": "Brahmin",
  "Bhumihar Brahmin": "Brahmin",
  "Bhvsar": "Bhavsar",
  "Brahmin": "Brahmin",
  "Brahmin Upper": "Brahmin",
  "brahmkshatriya": "Brahma Kshatriya",
  "Chaudhari Patel": "Patel / Patidar",
  "Chitpavan Brahmin": "Brahmin",
  "CKP (Chandraseniya Kayastha Prabhu)": "Kayastha",
  "Darbar": "Rajput",
  "Darji": "Darji",
  "Dasha Shrimali Vanik": "Vaniya",
  "DashaModh Vaishnav": "Vaishnav",
  "Deravashi Jain": "Jain",
  "Desai": "Desai",
  "Deshastha Brahmin": "Brahmin - Deshastha",
  "Devipujak": "Devipujak",
  "Dhobi": "Dhobi",
  "Dholakia Patel": "Patel / Patidar",
  "Gaud Saraswat Brahmin": "Brahmin",
  "Gaur Brahmin": "Brahmin",
  "Gujjar": "Gujjar",
  "Gupta Vaish": "Gupta",
  "Gurjar": "Gujjar",
  "Gurjar Gaur Brahmin": "Brahmin",
  "Gurjar Patel": "Patel / Patidar",
  "Havyaka Brahmin": "Brahmin",
  "hindu mochi": "Mochi",
  "Hindu Vanik": "Vaniya",
  "Iyengar": "Brahmin",
  "Iyer": "Brahmin",
  "Jadeja": "Rajput",
  "Jain": "Jain",
  "JAin Deravashi": "Jain",
  "Jain swetamber": "Jain",
  "Jain vish oswal": "Jain",
  "Jalawadi Sthank vashi": "Jain",
  "Jat": "Jat",
  "Jhalawadi Brahmin": "Brahmin",
  "kadava Patidar": "Patel / Patidar",
  "Kadva": "Patel / Patidar",
  "kadva Patel": "Patel / Patidar",
  "Kadva Patidar": "Patel / Patidar",
  "Kanyakubja Brahmin": "Brahmin",
  "Karhade Brahmin": "Brahmin",
  "karva Patel": "Patel / Patidar",
  "Kashmiri Pandit": "Brahmin",
  "Kayastha": "Kayastha",
  "Khadayata Vanik": "Vaniya",
  "Khatri": "Khatri",
  "Khedaval Brahmin": "Brahmin",
  "Koli": "Koli",
  "Koli Patel": "Patel / Patidar",
  "Kurmi": "Kurmi",
  "Kushwaha": "Kushwaha",
  "Kutchi Lohana": "Lohana",
  "Leuva Patel": "Patel / Patidar",
  "Leuva Patidar": "Patel / Patidar",
  "Leva": "Patel / Patidar",
  "Leva patidar": "Patel / Patidar",
  "Lohana": "Lohana",
  "Lohar": "Lohar",
  "Luhar": "Lohar",
  "Maithil Brahmin": "Brahmin",
  "Maratha": "Maratha",
  "Matiya Patidar": "Patel / Patidar",
  "Mehta": "Vaniya",
  "Mochi": "Mochi",
  "Modh Brahmin": "Brahmin",
  "Modh Vaishnav": "Vaishnav",
  "Modh Vanik": "Vaniya",
  "Nagar": "Brahmin",
  "Nagar Brahmin": "Brahmin",
  "Nair": "Nair",
  "Namboothiri": "Brahmin",
  "Oswal Marwadi": "Jain",
  "Panchal": "Vishwakarma",
  "Patel": "Patel / Patidar",
  "Prajapati": "Prajapati",
  "Rabari": "Rabari",
  "Rajgor Brahmin": "Brahmin",
  "Rajput": "Rajput",
  "Rajput (Other)": "Rajput",
  "Sachora Brahmin": "Brahmin",
  "Saini": "Saini",
  "Samaj Patel": "Patel / Patidar",
  "Saraswat Brahmin": "Brahmin",
  "Saryuparin Brahmin": "Brahmin",
  "Shah": "Vaniya",
  "Shrimali Brahmin": "Brahmin",
  "Sikh-Hindu Brahmin (Mohyal)": "Brahmin",
  "Sindhi": "Sindhi",
  "Sisodia": "Rajput",
  "Sompura": "Brahmin",
  "Sonar": "Sonar",
  "Sonara": "Sonar",
  "Soni": "Sonar",
  "Stanakvasi": "Jain",
  "Sutar": "Suthar",
  "Suthar": "Suthar",
  "Swetamber": "Jain",
  "Tapodhan Brahmin": "Brahmin",
  "Vaishnav": "Vaishnav",
  "Vaishnav Vanik": "Vaishnav",
  "Vaishnva": "Vaishnav",
  "Vaisnav": "Vaishnav",
  "Vaisnav Vaniya": "Vaishnav",
  "Valam Brahmin": "Brahmin",
  "Valmiki": "Valmiki",
  "Vanik": "Vaniya",
  "Vaniya": "Vaniya",
  "Vankar": "Vankar",
  "Visa Shrimali Vanik": "Vaniya",
  "Vishwakarma": "Vishwakarma",
  "Yadav": "Ahir / Yadav",
};

const ALIAS_INDEX = new Map(Object.entries(COMMUNITY_ALIASES).map(([from, to]) => [key(from), to]));

/** Pure version, so it can be checked without a database. `adminList` is the Community tag values. */
export function resolveCommunity(value: string | null | undefined, adminList: readonly string[]): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const k = key(value);

  const onList = adminList.find((v) => key(v) === k);
  if (onList) return onList;

  return ALIAS_INDEX.get(k) ?? COMMUNITY_OTHER;
}

/** The admin list is read often and changes rarely, so it is held for a short while. */
const TTL_MS = 30_000;
let cache: { at: number; values: string[] } | null = null;

export async function communityAdminList(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const cat = await prisma.tagCategory.findUnique({
    where: { name: COMMUNITY_CATEGORY },
    select: { values: { select: { value: true } } },
  });
  const values = (cat?.values ?? []).map((v) => v.value);
  cache = { at: Date.now(), values };
  return values;
}

/** Call from the write paths: `data.community = await coerceCommunity(data.community)`. */
export async function coerceCommunity(value: string | null | undefined): Promise<string | null> {
  return resolveCommunity(value, await communityAdminList());
}

/** Preferred communities: each entry is resolved the same way, "Other" is dropped, duplicates removed. */
export async function coercePrefCommunities(values: readonly string[]): Promise<string[]> {
  const list = await communityAdminList();
  const out = new Set<string>();
  for (const v of values) {
    const r = resolveCommunity(v, list);
    if (r && r !== COMMUNITY_OTHER) out.add(r);
  }
  return [...out];
}
