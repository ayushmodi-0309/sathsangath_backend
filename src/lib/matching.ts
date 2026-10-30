import { prisma } from "./db";
import { ageFrom } from "./util";

export const includeTags = {
  tags: { include: { tagValue: { include: { category: true } } } },
  photos: { orderBy: [{ isMain: "desc" as const }, { createdAt: "asc" as const }] },
  membershipPlans: { where: { endDate: { gte: new Date() } }, orderBy: { startDate: "desc" as const }, take: 1 },
};

/** Ids of members who have liked each other with `memberId` (mutual likes). */
export async function mutualIds(memberId: string) {
  const [mine, theirs] = await Promise.all([
    prisma.like.findMany({ where: { likerId: memberId }, select: { likedId: true } }),
    prisma.like.findMany({ where: { likedId: memberId }, select: { likerId: true } }),
  ]);
  const them = new Set(theirs.map((l) => l.likerId));
  return new Set(mine.map((l) => l.likedId).filter((id) => them.has(id)));
}

/** Optional member-chosen filters that narrow the curated feed. Empty/undefined means "no restriction". */
export type FeedFilters = {
  ageMin?: number; ageMax?: number; heightMin?: number; heightMax?: number;
  city?: string[]; maritalStatus?: string[]; education?: string[]; profession?: string[]; diet?: string[]; community?: string[];
  subCommunity?: string[]; state?: string[]; motherTongue?: string[]; familyType?: string[]; nativePlace?: string[];
  hasPhoto?: boolean;
  /** Approved within the last 14 days. */
  justJoined?: boolean;
  /** Same city as the viewer. */
  nearby?: boolean;
  /** Matches part of the profile code, e.g. "1042" or "SS-1042". */
  code?: string;
  sort?: "new" | "ageAsc" | "ageDesc" | "heightDesc" | "heightAsc";
};
// NOTE: income is deliberately not filterable. It is only revealed after a mutual like, and filtering on it would leak it.

const oneOf = (wanted: string[] | undefined, value: string | null) =>
  !wanted?.length || (!!value && wanted.some((w) => w.toLowerCase() === value.trim().toLowerCase()));

type Candidate = Awaited<ReturnType<typeof curatedFeed>>[number];

function applyFilters(items: Candidate[], f: FeedFilters, viewerCity?: string | null) {
  const code = f.code?.trim().toLowerCase();
  const since = Date.now() - 14 * 86400000;
  const out = items.filter((c) => {
    if (code && !c.profileCode.toLowerCase().includes(code)) return false;
    if (f.hasPhoto && !c.photoUrl) return false;
    if (f.justJoined && !(c.approvedAt && c.approvedAt.getTime() >= since)) return false;
    if (f.nearby && (!viewerCity || c.city?.trim().toLowerCase() !== viewerCity.trim().toLowerCase())) return false;
    const age = ageFrom(c.dob);
    if (f.ageMin !== undefined && age < f.ageMin) return false;
    if (f.ageMax !== undefined && age > f.ageMax) return false;
    if (f.heightMin !== undefined && (c.heightCm == null || c.heightCm < f.heightMin)) return false;
    if (f.heightMax !== undefined && (c.heightCm == null || c.heightCm > f.heightMax)) return false;
    return oneOf(f.city, c.city) && oneOf(f.maritalStatus, c.maritalStatus) && oneOf(f.education, c.education)
      && oneOf(f.profession, c.profession) && oneOf(f.diet, c.diet) && oneOf(f.community, c.community)
      && oneOf(f.subCommunity, c.subCommunity) && oneOf(f.state, c.state) && oneOf(f.motherTongue, c.motherTongue)
      && oneOf(f.familyType, c.familyType) && oneOf(f.nativePlace, c.nativePlace);
  });
  // The feed arrives newest-approved first; only re-sort when asked.
  const by: Record<string, (a: Candidate, b: Candidate) => number> = {
    ageAsc: (a, b) => ageFrom(a.dob) - ageFrom(b.dob), ageDesc: (a, b) => ageFrom(b.dob) - ageFrom(a.dob),
    heightAsc: (a, b) => (a.heightCm ?? 1e9) - (b.heightCm ?? 1e9), heightDesc: (a, b) => (b.heightCm ?? -1) - (a.heightCm ?? -1),
  };
  return f.sort && by[f.sort] ? [...out].sort(by[f.sort]) : out;
}

/** Distinct values (and age/height ranges) present in the viewer's own feed, so the app only offers filters that can match. */
export async function filterOptionsFor(viewerId: string) {
  const feed = await matchesFor(viewerId);
  const distinct = (pick: (c: Candidate) => string | null) =>
    [...new Set(feed.map(pick).filter((v): v is string => !!v && !!v.trim()).map((v) => v.trim()))].sort((a, b) => a.localeCompare(b));
  const ages = feed.map((c) => ageFrom(c.dob));
  const heights = feed.map((c) => c.heightCm).filter((h): h is number => h != null);
  return {
    ageMin: ages.length ? Math.min(...ages) : null, ageMax: ages.length ? Math.max(...ages) : null,
    heightMin: heights.length ? Math.min(...heights) : null, heightMax: heights.length ? Math.max(...heights) : null,
    cities: distinct((c) => c.city), maritalStatuses: distinct((c) => c.maritalStatus), educations: distinct((c) => c.education),
    professions: distinct((c) => c.profession), diets: distinct((c) => c.diet), communities: distinct((c) => c.community),
    subCommunities: distinct((c) => c.subCommunity), states: distinct((c) => c.state), motherTongues: distinct((c) => c.motherTongue),
    familyTypes: distinct((c) => c.familyType), nativePlaces: distinct((c) => c.nativePlace),
    withPhoto: feed.filter((c) => !!c.photoUrl).length, total: feed.length,
  };
}

/** Profiles the admin team suggested to this member, keyed by profile id. */
export async function suggestionsFor(viewerId: string) {
  const rows = await prisma.suggestion.findMany({ where: { viewerId }, orderBy: { createdAt: "desc" } });
  return new Map(rows.map((r) => [r.profileId, r]));
}

/**
 * The feed for one viewer: every APPROVED profile of the opposite gender, newest approval first.
 *
 * The viewer's stored partner preferences are deliberately NOT applied here. Narrowing the feed
 * by them left members with very little to look at and no way to tell why, so the feed starts
 * wide and the member narrows it themselves with the filters on the Feed screen, which arrive as
 * `filters`. Preferences are still recorded on the profile for the admin team to match on.
 */
export async function matchesFor(viewerId: string, filters?: FeedFilters) {
  const feed = await curatedFeed(viewerId);
  if (!filters) return feed;
  const viewerCity = filters.nearby ? (await prisma.member.findUnique({ where: { id: viewerId }, select: { city: true } }))?.city : undefined;
  return applyFilters(feed, filters, viewerCity);
}

async function curatedFeed(viewerId: string) {
  const viewer = await prisma.member.findUniqueOrThrow({ where: { id: viewerId }, select: { gender: true } });
  const hidden = await prisma.visibilityOverride.findMany({ where: { viewerId, action: "HIDE" }, select: { profileId: true } });
  const hide = new Set(hidden.map((o) => o.profileId));

  const candidates = await prisma.member.findMany({
    where: { status: "APPROVED", id: { not: viewerId }, gender: viewer.gender === "MALE" ? "FEMALE" : "MALE" },
    include: includeTags,
    orderBy: { approvedAt: "desc" },
  });

  // A HIDE override is the only thing that keeps an approved profile out of the feed. SHOW
  // overrides and admin suggestions no longer affect membership: they existed to push a profile
  // past the preference filters, and every approved profile is now in the feed to begin with.
  // Suggestions are still flagged on the items the /matches route returns.
  return candidates.filter((c) => !hide.has(c.id));
}
