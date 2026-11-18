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
 * NOTE: the targets are used as written. "Vaniya" must exist on the admin list for the stored
 * value to match what the app and the feed filter show.
 */
export const COMMUNITY_ALIASES: Record<string, string> = {
  "Patel": "Patel / Patidar",
  "Vaishnav": "Vaishnav",
  "Brahmin": "Brahmin",
  "Shah": "Vaniya",
  "Jain": "Jain",
  "Soni": "Sonar",
  "Leuva Patidar": "Patel / Patidar",
  "Vaniya": "Vaniya",
  "Mehta": "Vaniya",
  "Prajapati": "Prajapati",
  "Lohana": "Lohana",
  "Rajput": "Rajput",
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
