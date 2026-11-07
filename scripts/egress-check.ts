/**
 * Sanity-checks the feed queries and reports what they cost in egress.
 *
 * Read-only. Run against whichever database DATABASE_URL points at:
 *   npm run egress:check
 *
 * It picks one approved member of each gender as the "viewer" and prints, for
 * each: the feed page the app would show, the same page one filter deeper, the
 * filter options, and how many bytes came back. The old implementation read
 * every approved profile of the opposite gender for each of those, so the
 * per-call figures here are what the change was for.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { feedPage, filterOptionsFor, mutualIds, visibleProfile } from "../src/lib/matching";
import { adminListSelect, toAdminListItem } from "../src/lib/serializers";

const kb = (v: unknown) => `${(Buffer.byteLength(JSON.stringify(v)) / 1024).toFixed(1)} KB`;

async function report(viewerId: string, label: string) {
  const viewer = await prisma.member.findUniqueOrThrow({ where: { id: viewerId }, select: { profileCode: true, city: true, gender: true } });
  console.log(`\n=== ${label}: ${viewer.profileCode}, ${viewer.gender}, city ${viewer.city ?? "(none set)"} ===`);
  const mutual = await mutualIds(viewerId);

  const first = await feedPage(viewerId, {}, 1, 12, mutual);
  console.log(`page 1       : ${first.items.length} of ${first.total} profiles, ${kb(first.items)}`);

  const second = await feedPage(viewerId, {}, 2, 12, mutual);
  console.log(`page 2       : ${second.items.length} items, ${kb(second.items)}`);

  const overlap = first.items.filter((a) => second.items.some((b) => b.id === a.id));
  console.log(`paging       : ${overlap.length === 0 ? "stable (no overlap between pages 1 and 2)" : `UNSTABLE — ${overlap.length} profile(s) on both pages`}`);

  const opts = await filterOptionsFor(viewerId);
  console.log(`filter opts  : ages ${opts.ageMin}–${opts.ageMax}, heights ${opts.heightMin}–${opts.heightMax}, ${opts.cities.length} cities, ${opts.communities.length} communities, ${opts.withPhoto}/${opts.total} with a photo, ${kb(opts)}`);

  // Every filter the app can send, one at a time, against the values the feed
  // actually offers: each must come back non-empty, or the filter is broken.
  const city = opts.cities[0], community = opts.communities[0];
  const probes: Array<[string, Awaited<ReturnType<typeof feedPage>>]> = [];
  if (city) probes.push([`city=${city}`, await feedPage(viewerId, { city: [city] }, 1, 12, mutual)]);
  if (community) probes.push([`community=${community}`, await feedPage(viewerId, { community: [community] }, 1, 12, mutual)]);
  if (opts.ageMin != null) probes.push([`age ${opts.ageMin}–${opts.ageMax}`, await feedPage(viewerId, { ageMin: opts.ageMin, ageMax: opts.ageMax ?? undefined }, 1, 12, mutual)]);
  if (opts.heightMin != null) probes.push([`height ${opts.heightMin}–${opts.heightMax}`, await feedPage(viewerId, { heightMin: opts.heightMin, heightMax: opts.heightMax ?? undefined }, 1, 12, mutual)]);
  probes.push(["hasPhoto", await feedPage(viewerId, { hasPhoto: true }, 1, 12, mutual)]);
  probes.push(["justJoined", await feedPage(viewerId, { justJoined: true }, 1, 12, mutual)]);
  probes.push(["nearby", await feedPage(viewerId, { nearby: true }, 1, 12, mutual)]);
  if (first.items[0]) probes.push([`code=${first.items[0].profileCode}`, await feedPage(viewerId, { code: first.items[0].profileCode }, 1, 12, mutual)]);
  for (const sort of ["ageAsc", "ageDesc", "heightAsc", "heightDesc"] as const) {
    probes.push([`sort=${sort}`, await feedPage(viewerId, { sort }, 1, 12, mutual)]);
  }
  for (const [name, r] of probes) console.log(`  filter ${name.padEnd(28)} -> ${r.total} match(es)`);

  // The age filter is a dob range now, so check the edges really are inclusive.
  if (opts.ageMin != null && opts.ageMax != null) {
    const [onlyYoungest, onlyEldest, whole] = await Promise.all([
      feedPage(viewerId, { ageMax: opts.ageMin }, 1, 1, mutual),
      feedPage(viewerId, { ageMin: opts.ageMax }, 1, 1, mutual),
      feedPage(viewerId, { ageMin: opts.ageMin, ageMax: opts.ageMax }, 1, 1, mutual),
    ]);
    const ok = onlyYoungest.total > 0 && onlyEldest.total > 0 && whole.total === opts.total;
    console.log(`  age edges                        -> ${ok ? "inclusive, and the full range matches everyone" : `CHECK: youngest=${onlyYoungest.total}, eldest=${onlyEldest.total}, whole range=${whole.total} of ${opts.total}`}`);
  }

  // `nearby` must agree exactly with filtering on the viewer's own city.
  // Checked separately because a viewer with no city makes it trivially empty,
  // which looks the same as a broken condition.
  if (viewer.city?.trim()) {
    const [near, byCity] = await Promise.all([
      feedPage(viewerId, { nearby: true }, 1, 1, mutual),
      feedPage(viewerId, { city: [viewer.city] }, 1, 1, mutual),
    ]);
    console.log(`  nearby vs city=${viewer.city.padEnd(20)} -> ${near.total === byCity.total ? `agree (${near.total})` : `CHECK: nearby=${near.total}, city filter=${byCity.total}`}`);
  } else {
    console.log(`  nearby                           -> not checked: this viewer has no city set, so it is empty by definition`);
  }

  // "Just joined" is approvedAt within 14 days. If everyone matches, check
  // whether that is real (one bulk approval) rather than the filter misfiring.
  const approvals = await prisma.member.aggregate({
    where: { status: "APPROVED", gender: viewer.gender === "MALE" ? "FEMALE" : "MALE" },
    _min: { approvedAt: true }, _max: { approvedAt: true },
  });
  const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "none";
  console.log(`  approvedAt spread                -> ${day(approvals._min.approvedAt)} to ${day(approvals._max.approvedAt)}`);

  if (first.items[0]) {
    const target = first.items[0].id;
    const visible = await visibleProfile(viewerId, target, false);
    console.log(`  profile open                     -> ${visible ? `${kb(visible)} for one profile` : "CHECK: a profile in the feed was not openable"}`);
  }
}

/**
 * The admin member list. Every key the admin table and the membership modal
 * read must be present, or the list silently loses a column.
 */
async function reportAdminList() {
  console.log(`\n=== admin member list (one page of 20) ===`);
  const rows = await prisma.member.findMany({ select: adminListSelect, orderBy: { createdAt: "desc" }, take: 20 });
  const items = rows.map(toAdminListItem);
  console.log(`page of 20   : ${items.length} rows, ${kb(items)}`);

  const RENDERED = ["id", "profileCode", "fullName", "phone", "email", "gender", "age", "status",
    "city", "community", "education", "profession", "createdAt", "source", "currentPlan"] as const;
  const missing = items.length ? RENDERED.filter((k) => !(k in items[0])) : [];
  console.log(`fields       : ${missing.length === 0 ? `all ${RENDERED.length} present` : `CHECK: missing ${missing.join(", ")}`}`);

  const withPlan = items.find((i) => i.currentPlan);
  console.log(`currentPlan  : ${withPlan ? `resolved (${Object.keys(withPlan.currentPlan!).join(", ")})` : "no member on this page has a running plan"}`);
  const leaked = items.length ? ["passwordHash", "dob", "tags", "photos", "membershipPlans", "idProofUrl", "adminNote"].filter((k) => k in items[0]) : [];
  console.log(`not fetched  : ${leaked.length === 0 ? "dob, tags, photos, plans and the private columns are all absent, as intended" : `CHECK: ${leaked.join(", ")} still present`}`);
}

(async () => {
  // Prefer a viewer who has a city, so the `nearby` filter is actually exercised.
  const pick = async (gender: string) =>
    (await prisma.member.findFirst({ where: { status: "APPROVED", gender, city: { not: null } }, select: { id: true } }))
    ?? (await prisma.member.findFirst({ where: { status: "APPROVED", gender }, select: { id: true } }));
  const [male, female] = await Promise.all([pick("MALE"), pick("FEMALE")]);
  if (male) await report(male.id, "a male viewer");
  if (female) await report(female.id, "a female viewer");
  if (!male && !female) console.log("No approved members to check.");
  await reportAdminList();
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
