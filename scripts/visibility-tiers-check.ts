/**
 * API-LEVEL check of the three data-visibility tiers.
 *
 * This does not read the UI and does not call the serializers directly: it boots the real Express
 * app, mints real member tokens, and makes real HTTP requests to every member-facing endpoint that
 * returns somebody else's profile. Each response is then judged against the tier that pair is
 * supposed to be in:
 *
 *   TIER 1  public       — every approved member sees this. Age, height, education, profession,
 *                          community, city, diet, Manglik, family background, one photo.
 *   TIER 2  mutual       — both members liked each other. Adds date of birth, religion, parents'
 *                          names, income and partner preferences, and every photo.
 *                          Still NO name, NO mobile number, NO email.
 *   TIER 3  contact      — tier 2 plus the name, mobile number and email. Two ways in, both of
 *                          them our team's own decision: a mutual pair our team approved for
 *                          contact sharing (ContactShare), or a profile our team suggested to
 *                          this member (Suggestion).
 *
 * Every payload is also swept, key by key and value by value, for anything that must never reach
 * another member at any tier: the family's phone and email, the ID proof, the biodata document,
 * horoscope birth time and place, admin notes, the password hash and the device token. A tier
 * check that only looked at the keys it expected would miss a leak hiding anywhere else in the
 * JSON, so the sweep looks for the seeded values themselves.
 *
 * SAFETY: it writes fixtures, so it refuses to run against anything but a local database, and
 * refuses `postgres` as the database name. Point it at a throwaway:
 *
 *   createdb sathsangath_tier_check
 *   DATABASE_URL="postgresql://<you>@127.0.0.1:5432/sathsangath_tier_check" \
 *   DIRECT_URL="$DATABASE_URL" npx prisma db push --skip-generate
 *   DATABASE_URL="postgresql://<you>@127.0.0.1:5432/sathsangath_tier_check" npm run tiers:check
 *
 * Exit code 0 means every tier held. Non-zero prints what leaked and where.
 */
import "dotenv/config";
import type { Server } from "node:http";
import { app } from "../src/app";
import { prisma } from "../src/lib/db";
import { signToken } from "../src/lib/auth";

// ── Safety rails ──────────────────────────────────────────────────────────────

const url = process.env.DATABASE_URL ?? "";
const host = (url.match(/@([^/:?]+)/)?.[1] ?? "").toLowerCase();
const dbName = (url.match(/\/([^/?]+)(\?|$)/)?.[1] ?? "").toLowerCase();
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`REFUSING TO RUN: this script writes fixtures and DATABASE_URL points at "${host || "(no host)"}".\nPoint it at a throwaway database on localhost.`);
  process.exit(2);
}
if (!dbName || dbName === "postgres") {
  console.error(`REFUSING TO RUN: "${dbName || "(no database)"}" is not a throwaway database name.`);
  process.exit(2);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PORT = 4571;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

/** Values that are seeded per member so a leak can be recognised by its value, not just its key. */
const secretsOf = (tag: string) => ({
  fullName: `Fixture ${tag} Patel`,
  phone: `+9199000${String(tag.charCodeAt(0)).padStart(5, "0")}`,
  email: `${tag.toLowerCase()}@fixture.invalid`,
  familyPhone: `+9188000${String(tag.charCodeAt(0)).padStart(5, "0")}`,
  familyEmail: `family-${tag.toLowerCase()}@fixture.invalid`,
  birthTime: "04:35",
  birthPlace: `Birthplace-${tag}`,
  adminNote: `ADMIN-NOTE-${tag}`,
  idProofUrl: `docs/idproof-${tag}.pdf`,
  biodataFileUrl: `docs/biodata-${tag}.pdf`,
  fcmToken: `FCM-TOKEN-${tag}`,
});

type Tag = "V" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";

async function seedMember(tag: Tag, gender: "MALE" | "FEMALE", i: number) {
  const s = secretsOf(tag);
  const m = await prisma.member.create({
    data: {
      profileCode: `SS-TEST-${tag}`,
      status: "APPROVED",
      approvedAt: new Date(),
      source: "ADMIN",
      fullName: s.fullName,
      phone: s.phone,
      email: s.email,
      familyPhone: s.familyPhone,
      familyEmail: s.familyEmail,
      gender,
      dob: new Date(1995, 3, 10 + i),
      birthTime: s.birthTime,
      birthPlace: s.birthPlace,
      manglik: "No",
      heightCm: 160 + i,
      weightKg: 55 + i,
      maritalStatus: "Never married",
      community: "Patel",
      subCommunity: "Kadva",
      city: "Mehsana",
      district: "Mehsana",
      state: "Gujarat",
      country: "IN",
      nativePlace: "Unjha",
      religion: "Hindu",
      education: "B.Com",
      profession: "Accountant",
      income: "5-10 lakh",
      incomeCurrency: "INR",
      diet: "Vegetarian",
      fatherOccupation: "Farmer",
      motherOccupation: "Homemaker",
      brothers: 1,
      brothersMarried: 1,
      sisters: 0,
      sistersMarried: 0,
      familyBackground: "A close family from Mehsana.",
      about: "Looking for a like-minded family.",
      motherTongue: "Gujarati",
      fatherName: `Father of ${tag}`,
      motherName: `Mother of ${tag}`,
      familyType: "Joint",
      createdBy: "Parent",
      photoUrl: `https://fixture.invalid/${tag}-main.jpg`,
      biodataFileUrl: s.biodataFileUrl,
      idProofType: "AADHAAR",
      idProofUrl: s.idProofUrl,
      adminNote: s.adminNote,
      fcmToken: s.fcmToken,
      passwordHash: `HASH-${tag}`,
      prefAgeMin: 24,
      prefAgeMax: 32,
      prefHeightMinCm: 150,
      prefMaritalStatus: "Never married",
      prefRelocate: "Maybe",
      prefCommunities: "Patel",
      prefCities: "Mehsana",
      prefEducation: "B.Com",
      prefOccupation: "Accountant",
      prefCountries: "IN",
      prefIncomeMin: "5-10 lakh",
      prefNotes: `Preference note of ${tag}`,
      consentGiven: true,
      photos: {
        create: [
          { url: `https://fixture.invalid/${tag}-1.jpg`, isMain: true },
          { url: `https://fixture.invalid/${tag}-2.jpg`, isMain: false },
        ],
      },
    },
  });
  return { ...m, secrets: s };
}

const like = (likerId: string, likedId: string) => prisma.like.create({ data: { likerId, likedId } });
const pairOf = (a: string, b: string) => (a < b ? { memberAId: a, memberBId: b } : { memberAId: b, memberBId: a });

/**
 * The cast. The viewer is V; every other profile is one pair-state the tiers have to tell apart.
 *   A  nothing between them                                  -> tier 1
 *   B  mutual like, no ContactShare                           -> tier 2
 *   C  mutual like, ContactShare approved by our team          -> tier 3
 *   D  suggested by our team, no likes at all                  -> tier 3
 *   E  suggested AND hidden from V's feed by our team          -> tier 3, still reachable
 *   F  V liked them, no like back                              -> tier 1
 *   G  they liked V, no like back                              -> tier 1
 *   H  mutual like + an INTRODUCTION_FACILITATED request       -> tier 2 (an introduction unlocks nothing)
 *   I  suggested by our team AND a mutual like                 -> tier 3
 */
async function seed() {
  const V = await seedMember("V", "MALE", 0);
  const [A, B, C, D, E, F, G, H, I] = await Promise.all(
    (["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const).map((t, i) => seedMember(t, "FEMALE", i + 1)),
  );

  await Promise.all([
    like(V.id, B.id), like(B.id, V.id),
    like(V.id, C.id), like(C.id, V.id),
    like(V.id, F.id),
    like(G.id, V.id),
    like(V.id, H.id), like(H.id, V.id),
    like(V.id, I.id), like(I.id, V.id),
    prisma.contactShare.create({ data: pairOf(V.id, C.id) }),
    prisma.suggestion.create({ data: { viewerId: V.id, profileId: D.id, note: "Note on D" } }),
    prisma.suggestion.create({ data: { viewerId: V.id, profileId: E.id, note: "Note on E" } }),
    prisma.suggestion.create({ data: { viewerId: V.id, profileId: I.id, note: "Note on I" } }),
    prisma.visibilityOverride.create({ data: { viewerId: V.id, profileId: E.id, action: "HIDE" } }),
    prisma.introRequest.create({ data: { requesterId: V.id, targetId: H.id, status: "INTRODUCTION_FACILITATED" } }),
  ]);

  return { V, A, B, C, D, E, F, G, H, I };
}

// ── Tier rules ────────────────────────────────────────────────────────────────

/** Fields only a tier-2-or-better viewer may receive. Every fixture has all of them set. */
const TIER2_FIELDS = ["dob", "religion", "fatherName", "motherName", "income", "prefs"] as const;
/** Fields only a tier-3 viewer may receive. */
const TIER3_FIELDS = ["fullName", "contact"] as const;

type Tier = 1 | 2 | 3;
type Problem = { where: string; what: string };

const problems: Problem[] = [];
const fail = (where: string, what: string) => problems.push({ where, what });

const has = (o: Record<string, unknown>, k: string) => o[k] !== undefined && o[k] !== null;

/** Judges one profile object against the tier that pair is supposed to be in. */
function checkTier(where: string, body: Record<string, unknown>, tier: Tier) {
  // Tier 2 data: present from tier 2 up, absent at tier 1.
  for (const f of TIER2_FIELDS) {
    if (tier === 1 && has(body, f)) fail(where, `tier 1 must not carry "${f}" (got ${JSON.stringify(body[f])?.slice(0, 60)})`);
    if (tier > 1 && !has(body, f)) fail(where, `tier ${tier} should carry "${f}" and it is missing`);
  }
  // Tier 3 data: the name and the contact pair.
  for (const f of TIER3_FIELDS) {
    if (tier < 3 && has(body, f)) fail(where, `tier ${tier} must not carry "${f}" (got ${JSON.stringify(body[f])?.slice(0, 80)})`);
    if (tier === 3 && !has(body, f)) fail(where, `tier 3 should carry "${f}" and it is missing`);
  }
  if (tier === 3) {
    const c = body.contact as { phone?: unknown; email?: unknown } | undefined;
    if (!c?.phone || !c?.email) fail(where, `tier 3 contact should carry a phone and an email (got ${JSON.stringify(c)})`);
    if (body.contactApproved !== true) fail(where, `tier 3 should say contactApproved: true (got ${JSON.stringify(body.contactApproved)})`);
  } else if (body.contactApproved === true) {
    fail(where, `tier ${tier} must not say contactApproved: true`);
  }
  // Photos: one at tier 1, all of them from tier 2 up.
  const photos = (body.photos ?? []) as unknown[];
  if (tier === 1 && photos.length > 1) fail(where, `tier 1 should get one photo, got ${photos.length}`);
  if (tier > 1 && photos.length < 2) fail(where, `tier ${tier} should get every photo, got ${photos.length}`);
  // Tier 1 data must be there at every tier — otherwise "tier 1" could pass by sending nothing.
  for (const f of ["profileCode", "age", "community", "education", "profession", "city"]) {
    if (!has(body, f)) fail(where, `every tier should carry "${f}" and it is missing`);
  }
}

/** Walks a payload and reports any seeded value that must never reach another member. */
function sweep(where: string, payload: unknown, owner: { secrets: ReturnType<typeof secretsOf>; profileCode: string }, allowContact: boolean) {
  const s = owner.secrets;
  const forbidden: [string, string][] = [
    ["family phone", s.familyPhone],
    ["family email", s.familyEmail],
    ["birth time (horoscope)", s.birthTime],
    ["birth place (horoscope)", s.birthPlace],
    ["admin note", s.adminNote],
    ["ID proof key", s.idProofUrl],
    ["biodata document key", s.biodataFileUrl],
    ["FCM device token", s.fcmToken],
    ["password hash", `HASH-${owner.profileCode.replace("SS-TEST-", "")}`],
  ];
  if (!allowContact) {
    forbidden.push(["name", s.fullName], ["mobile number", s.phone], ["email", s.email]);
  }
  const json = JSON.stringify(payload ?? null);
  for (const [label, value] of forbidden) {
    if (value && json.includes(value)) fail(where, `LEAK: ${label} ("${value}") appears in the response`);
  }
  // Raw columns must never appear as keys either, whatever their value happens to be.
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if (["passwordHash", "idProofUrl", "biodataFileUrl", "fcmToken", "birthTime", "birthPlace", "familyPhone", "familyEmail", "visaExpiry"].includes(k)) {
          fail(where, `LEAK: key "${k}" should never be in a member-facing payload (at ${path}.${k})`);
        }
        if ((k === "phone" || k === "email") && path !== "$.contact" && !path.endsWith(".contact")) {
          fail(where, `LEAK: a bare "${k}" key outside the contact object (at ${path}.${k})`);
        }
        walk(val, `${path}.${k}`);
      }
    }
  };
  walk(payload, "$");
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const tokenFor = (id: string) => signToken({ kind: "member", id });

async function get(path: string, memberId: string) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${tokenFor(memberId)}` } });
  const body = await r.json().catch(() => null);
  return { status: r.status, body } as { status: number; body: any };
}

// ── The run ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding fixtures into ${dbName} …`);
  await prisma.$transaction([
    prisma.contactShare.deleteMany({}), prisma.suggestion.deleteMany({}), prisma.visibilityOverride.deleteMany({}),
    prisma.introRequest.deleteMany({}), prisma.like.deleteMany({}), prisma.photo.deleteMany({}),
    prisma.notification.deleteMany({}), prisma.memberTag.deleteMany({}), prisma.member.deleteMany({}),
  ]);
  const cast = await seed();
  const { V } = cast;

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(PORT, () => resolve(s));
  });
  console.log(`API up on ${BASE}\n`);

  const expected: Record<string, { who: typeof cast.A; tier: Tier; why: string }> = {
    A: { who: cast.A, tier: 1, why: "no like either way" },
    B: { who: cast.B, tier: 2, why: "mutual like, contact not approved" },
    C: { who: cast.C, tier: 3, why: "mutual like + ContactShare approved by our team" },
    D: { who: cast.D, tier: 3, why: "suggested by our team, no likes" },
    E: { who: cast.E, tier: 3, why: "suggested by our team, and hidden from the feed" },
    F: { who: cast.F, tier: 1, why: "viewer liked them, no like back" },
    G: { who: cast.G, tier: 1, why: "they liked the viewer, no like back" },
    H: { who: cast.H, tier: 2, why: "mutual like + facilitated introduction (which unlocks nothing)" },
    I: { who: cast.I, tier: 3, why: "suggested by our team, and a mutual like" },
  };

  // 1 ── One profile, opened on its own.
  console.log("GET /member/profiles/:id");
  for (const [tag, e] of Object.entries(expected)) {
    const r = await get(`/member/profiles/${e.who.id}`, V.id);
    const where = `profiles/${tag}`;
    if (r.status !== 200) { fail(where, `expected 200, got ${r.status} (${JSON.stringify(r.body)})`); continue; }
    checkTier(where, r.body, e.tier);
    sweep(where, r.body, e.who, e.tier === 3);
    console.log(`  ${tag} (${e.why.padEnd(58)}) -> tier ${e.tier} ${problems.some((p) => p.where === where) ? "FAILED" : "ok"}`);
  }

  // 2 ── The browse feed.
  console.log("\nGET /member/matches");
  const feed = await get("/member/matches?page=1&pageSize=50", V.id);
  const feedItems: any[] = feed.body?.items ?? [];
  for (const [tag, e] of Object.entries(expected)) {
    const item = feedItems.find((x) => x.id === e.who.id);
    const where = `matches/${tag}`;
    // Mutual matches live in the Interests tab, not the feed; E is hidden from it on purpose.
    const shouldBeInFeed = e.tier !== 2 && !["C", "I"].includes(tag) && tag !== "E";
    if (!item) {
      if (shouldBeInFeed) fail(where, "missing from the feed");
      continue;
    }
    checkTier(where, item, e.tier);
    sweep(where, item, e.who, e.tier === 3);
    console.log(`  ${tag} in feed -> tier ${e.tier} ${problems.some((p) => p.where === where) ? "FAILED" : "ok"}`);
  }

  // 3 ── The lists: interests sent, interests received, suggestions.
  for (const [path, tags] of [
    ["/member/likes", ["B", "C", "F", "H", "I"]],
    ["/member/likes/received", ["B", "C", "G", "H", "I"]],
    ["/member/suggestions", ["D", "E", "I"]],
  ] as const) {
    console.log(`\nGET ${path}`);
    const r = await get(path, V.id);
    const items: any[] = Array.isArray(r.body) ? r.body : [];
    for (const tag of tags) {
      const e = expected[tag];
      const where = `${path}/${tag}`;
      const item = items.find((x) => x.id === e.who.id);
      if (!item) { fail(where, `missing from ${path}`); continue; }
      checkTier(where, item, e.tier);
      sweep(where, item, e.who, e.tier === 3);
      console.log(`  ${tag} -> tier ${e.tier} ${problems.some((p) => p.where === where) ? "FAILED" : "ok"}`);
    }
    // Nothing else may ride along in these lists either.
    for (const item of items) {
      const owner = Object.values(expected).find((e) => e.who.id === item.id);
      if (!owner) fail(`${path}`, `unexpected profile ${item.profileCode} in the list`);
    }
  }

  // 4 ── The other direction. A suggestion is one-directional, and the suggested member must not
  //      get the viewer's contact details — or their name — out of it.
  console.log("\nThe other direction (each fixture opening the viewer's profile)");
  for (const [tag, tier] of [["D", 1], ["E", 1], ["B", 2], ["H", 2], ["C", 3], ["I", 2], ["A", 1]] as const) {
    const r = await get(`/member/profiles/${V.id}`, expected[tag].who.id);
    const where = `reverse/${tag}->V`;
    if (r.status !== 200) { fail(where, `expected 200, got ${r.status}`); continue; }
    checkTier(where, r.body, tier);
    sweep(where, r.body, V, tier === 3);
    console.log(`  ${tag} sees V -> tier ${tier} ${problems.some((p) => p.where === where) ? "FAILED" : "ok"}`);
  }

  // 5 ── The endpoints that are not profiles at all. None of them is a route to somebody's
  //      details, so no fixture's name, number, email or private column may appear in any of
  //      them — not even for the pairs that are at tier 3 on the profile endpoints.
  console.log("\nThe non-profile endpoints (nothing about anybody may ride along)");
  for (const path of ["/member/notifications", "/member/announcements", "/member/summary", "/member/matches/filter-options", "/member/corrections"]) {
    const r = await get(path, V.id);
    const where = `misc${path}`;
    if (r.status !== 200) { fail(where, `expected 200, got ${r.status}`); continue; }
    for (const e of Object.values(expected)) sweep(where, r.body, e.who, false);
    sweep(where, r.body, { secrets: { ...V.secrets, fullName: "\u0000", phone: "\u0000", email: "\u0000" }, profileCode: "SS-TEST-ignored" }, false);
    console.log(`  ${path.padEnd(34)} -> ${problems.some((p) => p.where === where) ? "FAILED" : "ok"}`);
  }

  // 6 ── The viewer's own profile is theirs to see in full, and must still not carry anybody else's.
  const self = await get(`/member/profiles/${V.id}`, V.id);
  if (self.status !== 200) fail("self", `own profile preview returned ${self.status}`);
  if (self.body?.contactApproved === true) fail("self", "own preview must not claim contactApproved");
  const me = await get("/member/me", V.id);
  if (!me.body?.phone || !me.body?.email) fail("self", "/member/me should carry the member's own contact details");
  for (const k of ["passwordHash", "idProofUrl", "biodataFileUrl", "adminNote", "birthTime", "birthPlace"]) {
    if (k === "adminNote" ? me.body?.adminNote : me.body?.[k]) fail("self", `/member/me must not carry "${k}"`);
  }

  await new Promise<void>((r) => server.close(() => r()));

  console.log(`\n${"─".repeat(70)}`);
  if (problems.length === 0) {
    console.log("PASS — all three tiers held on every endpoint checked.");
  } else {
    console.log(`FAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.log(`  [${p.where}] ${p.what}`);
  }
  await prisma.$disconnect();
  process.exit(problems.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(2);
});
