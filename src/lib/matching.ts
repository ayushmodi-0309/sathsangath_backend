import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { ageFrom } from "./util";
import { mutualSelect, publicSelect, type MutualMember, type PublicMember } from "./serializers";
import { DIETS, INCOME_CURRENCIES, INCOME_RANGES, INCOME_RANGES_BY_CURRENCY, incomeAtLeast } from "./choices";
import { ALL_COUNTRIES } from "./countries-data";
import { INDIA } from "./locations";

/** Member + tags + photos + plans: the whole record, for the admin portal and a member's own account. */
export const includeTags = {
  tags: { include: { tagValue: { include: { category: true } } } },
  photos: { orderBy: [{ isMain: "desc" as const }, { createdAt: "asc" as const }] },
  membershipPlans: { orderBy: { startDate: "desc" as const } }, // all plans: activePlan() picks the one running today (an open-ended plan has no end date)
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
  /** India only: the districts they live in, e.g. ["Mehsana"]. See lib/locations.ts. */
  district?: string[];
  /** ISO codes of the countries they live in, e.g. ["IN", "US"]. */
  country?: string[];
  /**
   * Living in India, or anywhere but India. "Anywhere but India" is the reason this is its own
   * filter rather than a country selection: it cannot be expressed by listing the 249 others.
   */
  residence?: "india" | "nri";
  /**
   * One band from that currency's ladder: matches that band and every band above
   * it, and only profiles who chose the same currency. No conversion.
   * `incomeCurrency` is ignored unless `incomeMin` is set; omitted means INR.
   */
  incomeMin?: string;
  incomeCurrency?: string;
  hasPhoto?: boolean;
  /** Approved within the last 14 days. */
  justJoined?: boolean;
  /** Same city as the viewer. */
  nearby?: boolean;
  /** Matches part of the profile code, e.g. "1042" or "SS-1042". */
  code?: string;
  sort?: "new" | "ageAsc" | "ageDesc" | "heightDesc" | "heightAsc";
};
/*
 * INCOME. A member's own income band stays mutual-only on the profile itself
 * (see toMutualProfile), but the feed can be narrowed by `incomeMin`, the way
 * the admin members list can and the way a partner preference reads: "at least
 * this much". This is a deliberate reversal of the older rule that income was
 * not filterable at all.
 *
 * It is a known trade-off, not an oversight: a filter is an oracle, so a
 * determined viewer can bracket a profile's band by moving `incomeMin` and
 * watching the profile appear and disappear. Only the band is exposed this
 * way, never the figure, and only for profiles already in the viewer's feed.
 * There is deliberately no `incomeMax`, which would make bracketing a single
 * request instead of several.
 */

/** The text columns a member can filter the feed on. */
type TextFilterField = "city" | "maritalStatus" | "education" | "profession" | "diet" | "community"
  | "subCommunity" | "state" | "district" | "motherTongue" | "familyType" | "nativePlace" | "country";

const TEXT_FILTER_FIELDS = ["city", "maritalStatus", "education", "profession", "diet", "community",
  "subCommunity", "state", "district", "motherTongue", "familyType", "nativePlace", "country"] as const satisfies readonly TextFilterField[];

/**
 * The four columns that make up one place of living. They are faceted together, by a single
 * groupBy, so the clients can cascade country → state → district → city/town and never offer a
 * value that matches nothing. The flat per-field lists are derived from the same rows.
 */
const LOCATION_FIELDS = ["country", "state", "district", "city"] as const satisfies readonly TextFilterField[];

/** A profile as the browse feed serves it. */
export type Candidate = PublicMember;

/** "Has a photo", as the feed and the filter counts both mean it: set, and not blank. */
const HAS_PHOTO: Prisma.MemberWhereInput = { photoUrl: { not: null }, NOT: { photoUrl: "" } };

/**
 * The `dob` of someone whose birthday is today and who turns `age` today.
 *
 * This is the boundary ageFrom() uses, so `dob <= dobAt(n)` is exactly
 * "aged n or older" and `dob > dobAt(n + 1)` is exactly "aged n or younger".
 * Age filters are translated this way rather than computed per row, so the
 * database can do them.
 */
const dobAt = (age: number) => {
  const n = new Date();
  return new Date(n.getFullYear() - age, n.getMonth(), n.getDate());
};

/**
 * Case-insensitive "is one of", matching the old in-memory comparison. The
 * values come straight back from filterOptionsFor(), which hands out the
 * trimmed values actually present in the feed, so these compare equal.
 */
const textIn = (field: TextFilterField, wanted?: string[]): Prisma.MemberWhereInput | null => {
  const vals = [...new Set((wanted ?? []).map((w) => w.trim()).filter(Boolean))];
  return vals.length
    ? { OR: vals.map((v) => ({ [field]: { equals: v, mode: "insensitive" } } as Prisma.MemberWhereInput)) }
    : null;
};

/** Ordering per `sort`. Age is dob inverted; height puts the unknowns last, as the old comparators did. */
const ORDER: Record<NonNullable<FeedFilters["sort"]>, Prisma.MemberOrderByWithRelationInput> = {
  new: { approvedAt: "desc" },
  ageAsc: { dob: "desc" },
  ageDesc: { dob: "asc" },
  heightAsc: { heightCm: { sort: "asc", nulls: "last" } },
  heightDesc: { heightCm: { sort: "desc", nulls: "last" } },
};

/**
 * The viewer's feed, as a set of conditions rather than rows: every APPROVED
 * profile of the opposite gender, minus themselves and minus anyone our team
 * has explicitly hidden from them.
 *
 * The viewer's stored partner preferences are deliberately NOT applied. Narrowing the feed
 * by them left members with very little to look at and no way to tell why, so the feed starts
 * wide and the member narrows it themselves with the filters on the Feed screen, which arrive as
 * `FeedFilters`. Preferences are still recorded on the profile for the admin team to match on.
 *
 * A HIDE override is the only thing that keeps an approved profile out of the feed. SHOW
 * overrides and admin suggestions no longer affect membership: they existed to push a profile
 * past the preference filters, and every approved profile is now in the feed to begin with.
 * Suggestions are still flagged on the items the /matches route returns.
 *
 * The overrides are a correlated `none` rather than a fetched id list, so no
 * override row ever crosses the wire.
 */
async function feedScope(viewerId: string) {
  const viewer = await prisma.member.findUniqueOrThrow({ where: { id: viewerId }, select: { gender: true, city: true, district: true } });
  const conditions: Prisma.MemberWhereInput[] = [
    { status: "APPROVED" },
    { id: { not: viewerId } },
    { gender: viewer.gender === "MALE" ? "FEMALE" : "MALE" },
    { overridesAsProfile: { none: { viewerId, action: "HIDE" } } },
  ];
  return { conditions, viewerPlace: { district: viewer.district, city: viewer.city } };
}

/** One condition per active filter. Everything the member can narrow by is expressible in SQL. */
function filterConditions(f: FeedFilters, viewerPlace: { district: string | null; city: string | null }): Prisma.MemberWhereInput[] {
  const and: Prisma.MemberWhereInput[] = [];
  const code = f.code?.trim();
  if (code) and.push({ profileCode: { contains: code, mode: "insensitive" } });
  if (f.hasPhoto) and.push(HAS_PHOTO);
  if (f.justJoined) and.push({ approvedAt: { gte: new Date(Date.now() - 14 * 86400000) } });
  // India, or not India. `country` defaults to "IN" and is never null, so this is a clean split of
  // the feed in two; the comparison is case-insensitive only to be safe about older rows.
  if (f.residence === "india") and.push({ country: { equals: INDIA, mode: "insensitive" } });
  if (f.residence === "nri") and.push({ NOT: { country: { equals: INDIA, mode: "insensitive" } } });
  // "Nearby" means the viewer's own district, which is the useful radius now that districts are a
  // closed list — two families in Kadi and Unjha are neighbours, and only a district says so. It
  // falls back to the city for a viewer whose district has not been filled in yet. A viewer with
  // neither has no "nearby": `in: []` matches nothing, which is what the old per-row check did.
  if (f.nearby) {
    const district = viewerPlace.district?.trim();
    const city = viewerPlace.city?.trim();
    and.push(district ? { district: { equals: district, mode: "insensitive" } }
      : city ? { city: { equals: city, mode: "insensitive" } }
      : { id: { in: [] } });
  }
  if (f.ageMin !== undefined) and.push({ dob: { lte: dobAt(f.ageMin) } });
  if (f.ageMax !== undefined) and.push({ dob: { gt: dobAt(f.ageMax + 1) } });
  // A null height fails a range test in SQL just as it did in the old comparison.
  if (f.heightMin !== undefined) and.push({ heightCm: { gte: f.heightMin } });
  if (f.heightMax !== undefined) and.push({ heightCm: { lte: f.heightMax } });
  // "At least this band" inside one currency. The ladder is ordered, so this is a
  // set membership test rather than a string comparison. An unrecognised pair is
  // ignored. A currency on its own does not filter, and nothing is converted, so
  // a dollar minimum never matches a rupee salary.
  if (f.incomeMin) {
    const currency = f.incomeCurrency?.trim().toUpperCase() || "INR";
    const bands = incomeAtLeast(currency, f.incomeMin);
    if (bands) and.push({ incomeCurrency: currency, income: { in: bands } });
  }
  for (const field of TEXT_FILTER_FIELDS) {
    const w = textIn(field, f[field]);
    if (w) and.push(w);
  }
  return and;
}

export type FeedPage = { items: Candidate[]; total: number };

/**
 * One page of the viewer's feed, and the number of profiles their filters match.
 *
 * EGRESS: filtering, sorting and paging all happen in Postgres, so only the
 * rows on the page in hand cross the wire. This used to read every approved
 * profile of the opposite gender — all columns, plus the tag, photo and plan
 * joins — and then filter, sort and slice in memory, which meant ~400 rows
 * fetched to serve 12, on every page flip.
 *
 * `exclude` drops the viewer's mutual matches: those live in the Interests tab,
 * not in the browse feed. Ordering is tie-broken on `id` so that paging is
 * stable — without it, two profiles sharing an approvedAt (or a height) can
 * swap places between requests and show up twice, or not at all, as the member
 * scrolls.
 */
export async function feedPage(viewerId: string, filters: FeedFilters, page: number, pageSize: number, exclude: Set<string>): Promise<FeedPage> {
  const { conditions, viewerPlace } = await feedScope(viewerId);
  const where: Prisma.MemberWhereInput = {
    AND: [
      ...conditions,
      ...filterConditions(filters, viewerPlace),
      ...(exclude.size ? [{ id: { notIn: [...exclude] } }] : []),
    ],
  };
  const [total, items] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.findMany({
      where,
      select: publicSelect,
      orderBy: [ORDER[filters.sort ?? "new"], { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, items };
}

/**
 * One profile, if this viewer is allowed to open it: it is in their feed, the
 * two of them have liked each other, or our team suggested it to them.
 *
 * EGRESS: a single row. This used to build the viewer's entire feed and then
 * search it in memory, so opening one profile — or liking it — read every
 * approved profile out of the database to answer a question about one of them.
 */
export async function visibleProfile(viewerId: string, profileId: string, bypassFeed: boolean): Promise<MutualMember | null> {
  // A mutual match — or a profile our team suggested — stays reachable even if
  // they have since been hidden from this viewer's feed, which is what the old
  // lookup fell back to. The team put this pair together on purpose.
  if (bypassFeed) return prisma.member.findFirst({ where: { id: profileId, status: "APPROVED" }, select: mutualSelect });
  const { conditions } = await feedScope(viewerId);
  return prisma.member.findFirst({ where: { AND: [...conditions, { id: profileId }] }, select: mutualSelect });
}

/** Ids of the profiles our team suggested to this member. */
export async function suggestionsFor(viewerId: string) {
  const rows = await prisma.suggestion.findMany({ where: { viewerId }, select: { profileId: true } });
  return new Set(rows.map((r) => r.profileId));
}

/**
 * Diet is the one list offered in full rather than feed-first. The six choices
 * are the same everywhere a diet is entered or filtered — the intake forms, the
 * admin members list and now both member clients — and a member reads a missing
 * choice as the app being broken rather than as "nobody in your feed eats that".
 * A choice that matches nothing simply returns an empty page.
 *
 * Values already stored that are not one of the six (older imports) are kept at
 * the end, so a profile saved as "Veg" stays reachable.
 */
function dietChoices(inFeed: string[]): string[] {
  const canonical = new Set<string>(DIETS.map((d) => d.toLowerCase()));
  return [...DIETS, ...inFeed.filter((d) => !canonical.has(d.toLowerCase()))];
}

const COUNTRY_NAME = new Map(ALL_COUNTRIES.map(([code, name]) => [code, name]));

/**
 * Country codes ordered by the name the clients show, not by the code, so the
 * list does not read as alphabetised-by-accident. Unlike diet this one stays
 * feed-first: offering all 250 countries when the feed holds three is noise.
 */
const byCountryName = (codes: string[]) =>
  [...codes].sort((a, b) => (COUNTRY_NAME.get(a) ?? a).localeCompare(COUNTRY_NAME.get(b) ?? b));

type PlaceRow = { country: string | null; state: string | null; district: string | null; city: string | null; _count: { _all: number } };

/**
 * One groupBy over (country, state, district, city) turned into the cascade the Location filter
 * needs, plus the flat per-column lists the older clients read.
 *
 * A blank at one level does not hide the levels above it: a member with a state but no district
 * still counts towards their state, and towards their country.
 */
function locationFacets(rows: PlaceRow[]) {
  type Leaf = { name: string; count: number };
  type Node = { name: string; count: number; children: Map<string, Node> };
  const countries = new Map<string, Node>();
  const flat = { countries: new Set<string>(), states: new Set<string>(), districts: new Set<string>(), cities: new Set<string>() };

  const bump = (into: Map<string, Node>, name: string, n: number) => {
    const node = into.get(name) ?? { name, count: 0, children: new Map() };
    node.count += n;
    into.set(name, node);
    return node;
  };

  for (const r of rows) {
    const n = r._count._all;
    const country = (r.country ?? "").trim();
    const state = (r.state ?? "").trim();
    const district = (r.district ?? "").trim();
    const city = (r.city ?? "").trim();
    if (!country) continue;
    flat.countries.add(country);
    const c = bump(countries, country, n);
    if (!state) continue;
    flat.states.add(state);
    const st = bump(c.children, state, n);
    if (!district) continue;
    flat.districts.add(district);
    const d = bump(st.children, district, n);
    if (!city) continue;
    flat.cities.add(city);
    bump(d.children, city, n);
  }

  const alpha = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const leaves = (m: Map<string, Node>): Leaf[] => [...m.values()].map(({ name, count }) => ({ name, count })).sort(alpha);

  const tree = [...countries.values()]
    .map((c) => ({
      code: c.name,
      name: COUNTRY_NAME.get(c.name) ?? c.name,
      count: c.count,
      states: [...c.children.values()]
        .map((st) => ({
          name: st.name,
          count: st.count,
          districts: [...st.children.values()]
            .map((d) => ({ name: d.name, count: d.count, cities: leaves(d.children) }))
            .sort(alpha),
        }))
        .sort(alpha),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
  return { tree, flat: { countries: [...flat.countries], states: sorted(flat.states), districts: sorted(flat.districts), cities: sorted(flat.cities) } };
}

/**
 * Distinct values (and age/height ranges) present in the viewer's own feed, so the app only offers filters that can match.
 *
 * EGRESS: aggregates, so Postgres does the work and sends back only the
 * distinct values themselves. This used to pull the whole feed in order to
 * reduce it in memory, which cost as much as the feed itself on every load of
 * the Feed screen.
 */
export async function filterOptionsFor(viewerId: string) {
  const { conditions } = await feedScope(viewerId);
  const where: Prisma.MemberWhereInput = { AND: conditions };

  const distinct = async (field: TextFilterField) => {
    const rows = await prisma.member.groupBy({ by: [field], where });
    const vals = (rows as Array<Record<string, string | null>>).map((r) => (r[field] ?? "").trim()).filter(Boolean);
    return [...new Set(vals)].sort((a, b) => a.localeCompare(b));
  };

  // The four location columns come back from one groupBy instead of four, which is both cheaper
  // and the only way to know which districts sit under which state *in this feed*.
  const otherFields = TEXT_FILTER_FIELDS.filter((f) => !LOCATION_FIELDS.includes(f as never));
  const [texts, places, range, total, withPhoto] = await Promise.all([
    Promise.all(otherFields.map(distinct)),
    prisma.member.groupBy({ by: [...LOCATION_FIELDS], where, _count: { _all: true } }),
    prisma.member.aggregate({ where, _min: { dob: true, heightCm: true }, _max: { dob: true, heightCm: true } }),
    prisma.member.count({ where }),
    prisma.member.count({ where: { AND: [...conditions, HAS_PHOTO] } }),
  ]);
  const byField = Object.fromEntries(otherFields.map((f, i) => [f, texts[i]])) as Record<string, string[]>;
  const [maritalStatuses, educations, professions, feedDiets, communities,
    subCommunities, motherTongues, familyTypes, nativePlaces] =
    ["maritalStatus", "education", "profession", "diet", "community",
      "subCommunity", "motherTongue", "familyType", "nativePlace"].map((f) => byField[f]);

  const location = locationFacets(places);
  const { cities, states, districts, countries } = location.flat;

  return {
    // ageFrom() inverts dob: the earliest date of birth in the feed is the eldest member.
    ageMin: range._max.dob ? ageFrom(range._max.dob) : null,
    ageMax: range._min.dob ? ageFrom(range._min.dob) : null,
    heightMin: range._min.heightCm, heightMax: range._max.heightCm,
    cities, maritalStatuses, educations, professions, diets: dietChoices(feedDiets), communities,
    subCommunities, states, motherTongues, familyTypes, nativePlaces,
    districts,
    /**
     * The same four columns as a cascade: country → state → district → city/town, with a count at
     * every level. This is what the Location filter renders. The flat `cities`/`states`/
     * `countries` lists above are the same values and stay for the app builds already out there.
     */
    locationTree: location.tree,
    countries: byCountryName(countries),
    // The name for each code above. Sent rather than looked up client-side
    // because the mobile app carries only the handful of countries whose phone
    // rules it needs, and would otherwise show a bare "DE".
    countryNames: Object.fromEntries(countries.map((c) => [c, COUNTRY_NAME.get(c) ?? c])),
    // The rupee ladder, kept for older clients. incomeRangesByCurrency is the
    // full set: a minimum is a threshold on one ladder, not a conversion.
    incomeRanges: [...INCOME_RANGES],
    incomeRangesByCurrency: Object.fromEntries(INCOME_CURRENCIES.map((c) => [c, [...INCOME_RANGES_BY_CURRENCY[c]]])),
    withPhoto, total,
  };
}
