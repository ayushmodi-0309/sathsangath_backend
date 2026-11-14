import { Router, type RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/db";
import { HttpError, wrap } from "../lib/http";
import { requireApproved, requireMember } from "../lib/auth";
import { feedPage, filterOptionsFor, includeTags, mutualIds, suggestionsFor, visibleProfile } from "../lib/matching";
import { mutualSelect, toMutualProfile, toPublicProfile, toSelf, type MutualMember } from "../lib/serializers";
import { learnTagValuesFor } from "../lib/tags";
import { coerceEducation, coerceProfession } from "../lib/closed-lists";
import { activity, list, memberLabel } from "../lib/util";
import { checkAnyPhone, isPlaceholderPhone } from "../lib/phone";
import { resolveLegacyCity, resolveLocation } from "../lib/locations";
import { sendMutualMatch } from "../lib/notify";
import { sendPush } from "../lib/fcm";
import { checkSiblingCounts, ID_PROOF_TYPES, manglikClearable, normalizeVisaType, photoUpload, upload, VISA_TYPES, weightKgField } from "./public";
import { INCOME_CURRENCIES, incomeFieldsPatch } from "../lib/choices";
import { removeObject, saveUpload } from "../lib/storage";
import { syncMainPhoto } from "../lib/photos";
import { isContactShared, sharedWith } from "../lib/contact-share";

export const memberRouter = Router();
memberRouter.use(requireMember);

const MAX_PHOTOS = 6;
const STATUS_LABEL: Record<string, string> = {
  NEW: "Request received",
  UNDER_REVIEW: "Under review by Sathsangath",
  INTRODUCTION_FACILITATED: "Introduction arranged",
  CLOSED: "Closed",
};

const me = (req: { actor?: { id: string } }) => req.actor!.id;
/**
 * Just enough of a member to notify them: the email and SMS templates, the
 * push, and the activity log. Contact details and the device token are private,
 * so they are not part of mutualSelect and are read here on their own.
 */
const notifySelect = { id: true, fullName: true, profileCode: true, phone: true, email: true, fcmToken: true } satisfies Prisma.MemberSelect;
const loadMe = (id: string) => prisma.member.findUniqueOrThrow({ where: { id }, include: includeTags });
/**
 * A mutual-match profile in a list.
 *
 * The name, mobile number and email are added only for pairs our team has approved for contact
 * sharing — and all three together. A list used to hand over the name while withholding the
 * number, so the same pair read as two different tiers depending on which screen you were on.
 */
const mutualView = async (m: MutualMember, shared: Set<string>) => {
  const approved = shared.has(m.id);
  return {
    ...(await toMutualProfile(m)),
    contactApproved: approved,
    contact: approved ? contactOf(m) : null,
    ...(approved ? { fullName: m.fullName } : {}),
  };
};

/** Mobile number and email as a member-facing pair. A placeholder phone goes out as nothing. */
const contactOf = (m: { phone: string; email: string | null }) => ({ phone: isPlaceholderPhone(m.phone) ? null : m.phone, email: m.email });

/**
 * A profile OUR TEAM suggested to this viewer ("Suggested by Sathsangath").
 *
 * It is shown in full — every photo, date of birth, religion, parents' names, income, partner
 * preferences — and, unlike every other member-facing shape, with the name, mobile number and
 * email as well. A suggestion is the team hand-picking this profile for this member, which is
 * the same decision a ContactShare records for a mutual pair, so it carries its own approval and
 * nothing further has to be unlocked. Removing the suggestion takes the access away again.
 *
 * The reveal is one-directional: it is the suggested profile that the viewer sees in full. The
 * other member is told nothing and sees nothing of this viewer until they are a mutual match.
 */
const suggestedView = async (m: MutualMember) => ({
  ...(await toMutualProfile(m)),
  fullName: m.fullName,
  contactApproved: true,
  contact: contactOf(m),
});

const who = (m: { id: string; profileCode: string; fullName: string }) => ({ type: "MEMBER" as const, memberId: m.id, name: memberLabel(m) });

// ---------- Account ----------
memberRouter.get("/me", wrap(async (req, res) => { res.json(await toSelf(await loadMe(me(req)))); }));

// ---------- FCM token ----------
memberRouter.patch("/fcm-token", wrap(async (req, res) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
  await prisma.member.update({ where: { id: me(req) }, data: { fcmToken: token } });
  res.json({ ok: true });
}));

/**
 * Every change a member makes to their own bio data comes with the same confirmation they gave when they
 * registered: they accept the privacy policy and take responsibility for what they upload.
 */
function requireConsent(body: { consent?: unknown }) {
  if (body.consent !== true && body.consent !== "true") {
    throw new HttpError(422, "Please tick the confirmation box to save your changes.", { fields: { consent: "Please tick the box to confirm" } });
  }
}

// Only contact details are editable by the member. Bio data changes go through the admin.
memberRouter.patch("/me", wrap(async (req, res) => {
  requireConsent(req.body);
  const d = z.object({
    phone: z.string().transform((v, ctx) => { const r = checkAnyPhone(v); if (!r.ok) { ctx.addIssue({ code: "custom", message: r.error }); return z.NEVER; } return r.value; }).optional(),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => null)),
    // A blank family number clears it; anything else must be a valid number.
    familyPhone: z.string().trim().transform((v, ctx) => { if (!v) return null; const r = checkAnyPhone(v); if (!r.ok) { ctx.addIssue({ code: "custom", message: r.error }); return z.NEVER; } return r.value; }).optional(),
    familyEmail: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => null)),
  }).parse(req.body);
  if (d.phone) {
    const other = await prisma.member.findFirst({ where: { phone: d.phone, id: { not: me(req) } } });
    if (other) throw new HttpError(409, "This mobile number is already registered.");
  }
  const m = await prisma.member.update({ where: { id: me(req) }, data: d, include: includeTags });
  await activity(who(m), "UPDATED_CONTACT_DETAILS", "Member", m.id);
  res.json(await toSelf(m));
}));

// The member replaces their own ID proof. The old file is deleted once the new one is saved.
memberRouter.put("/id-proof", upload.single("idproof"), wrap(async (req, res) => {
  requireConsent(req.body);
  const file = req.file;
  if (!file) throw new HttpError(422, "Choose the ID proof file to upload.", { fields: { idProof: "Choose a file" } });
  const type = String(req.body.idProofType ?? "").trim().toUpperCase();
  if (!(ID_PROOF_TYPES as readonly string[]).includes(type)) throw new HttpError(422, "Choose the type of ID proof.", { fields: { idProofType: "Choose the type of ID proof" } });
  const before = await prisma.member.findUniqueOrThrow({ where: { id: me(req) }, select: { idProofUrl: true } });
  const key = await saveUpload("docs", file);
  await prisma.member.update({ where: { id: me(req) }, data: { idProofUrl: key, idProofType: type } });
  await removeObject(before.idProofUrl);
  const m = await loadMe(me(req));
  await activity(who(m), "UPDATED_ID_PROOF", "Member", m.id, { type });
  res.json(await toSelf(m));
}));

// All profile fields except fullName are self-editable. Contact/phone changes still go through PATCH /member/me.
memberRouter.patch("/profile", wrap(async (req, res) => {
  requireConsent(req.body);
  const str = z.string().trim().max(2000).optional();
  const num = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().optional());
  const clearableCount = z.preprocess(
    (v) => (v === "" || v === null ? null : v === undefined ? undefined : Number(v)),
    z.number("Enter a whole number").int("Enter a whole number").min(0, "Cannot be less than 0").max(20, "Enter 20 or fewer").nullable().optional(),
  );
  const arr = z.preprocess((v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
    return undefined;
  }, z.array(z.string().trim()).optional());

  // "" is an explicit clear. A missing key is left untouched.
  const clearable = z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(2000).nullable().optional());
  const d = z.object({
    gender: z.string().trim().toUpperCase().pipe(z.enum(["MALE", "FEMALE"])).optional(),
    dob: z.string().refine((s) => { const d = new Date(s); const age = (Date.now() - d.getTime()) / 31557600000; return !isNaN(d.getTime()) && age >= 18 && age <= 80; }, "Enter a valid date of birth (18 years or older)").optional(),
    heightCm: num, weightKg: weightKgField,
    maritalStatus: str, motherTongue: str, diet: str, createdBy: str,
    // Optional: "" clears it, a missing key leaves it alone, and an older app build that never
    // sends it is unaffected.
    manglik: manglikClearable,
    community: str, subCommunity: str,
    // Place of living, a closed cascade: see lib/locations.ts. "" clears, a missing key leaves it
    // alone. An app build that predates the district still sends only city + state; its city is
    // resolved to a district server-side rather than refused.
    city: clearable, state: clearable, district: clearable, nativePlace: str,
    // Where they live. Any non-empty text is kept, so a country we do not list still saves.
    country: z.string().trim().min(1).max(100).optional(),
    visaType: clearable, visaExpiry: clearable,
    // Closed lists, and clearable: "" empties the field, a missing key leaves it alone.
    education: clearable, profession: clearable,
    // "" clears the band. The currency is checked against the band below; a missing currency keeps the stored one.
    income: clearable,
    incomeCurrency: z.preprocess(
      (v) => (v === "" || v == null ? undefined : typeof v === "string" ? v.trim().toUpperCase() : v),
      z.enum(INCOME_CURRENCIES, { message: "Choose a currency from the list" }).optional(),
    ),
    about: str,
    fatherName: str, fatherOccupation: str,
    motherName: str, motherOccupation: str,
    // Four counts; "" clears one. `siblings` is retired but still accepted and ignored, so an
    // older app build keeps saving without an error. See DEPRECATIONS.md.
    brothers: clearableCount, brothersMarried: clearableCount,
    sisters: clearableCount, sistersMarried: clearableCount,
    siblings: str,
    familyType: str, familyBackground: str,
    prefAgeMin: num, prefAgeMax: num, prefHeightMinCm: num,
    prefMaritalStatus: str, prefRelocate: str,
    prefIncomeMin: clearable,
    prefIncomeCurrency: z.preprocess(
      (v) => (v === "" || v == null ? undefined : typeof v === "string" ? v.trim().toUpperCase() : v),
      z.enum(INCOME_CURRENCIES, { message: "Choose a currency from the list" }).optional(),
    ),
    prefNotes: str,
    prefCommunities: arr, prefCities: arr, prefEducation: arr, prefOccupation: arr, prefCountries: arr,
  }).parse(req.body);

  const { prefCommunities, prefCities, prefEducation, prefOccupation, prefCountries, dob, city, state, district, country, visaType, visaExpiry, income, incomeCurrency, prefIncomeMin, prefIncomeCurrency, siblings: _retiredSiblings, ...rest } = d;
  // Closed lists. A key that was not sent stays untouched; "" still clears the field.
  if (rest.education !== undefined) rest.education = coerceEducation(rest.education);
  if (rest.profession !== undefined) rest.profession = coerceProfession(rest.profession);

  const member = await loadMe(me(req));
  // "3 of my 2 brothers are married" has to be refused here too, not only on the public form.
  // A field that was not sent keeps whatever is already stored, so the stored value is the
  // fallback for the comparison.
  const siblingIssues: Record<string, string> = {};
  checkSiblingCounts(
    {
      brothers: rest.brothers !== undefined ? rest.brothers : member.brothers,
      brothersMarried: rest.brothersMarried !== undefined ? rest.brothersMarried : member.brothersMarried,
      sisters: rest.sisters !== undefined ? rest.sisters : member.sisters,
      sistersMarried: rest.sistersMarried !== undefined ? rest.sistersMarried : member.sistersMarried,
    },
    (path, message) => { siblingIssues[path] = message; },
  );
  if (Object.keys(siblingIssues).length) {
    throw new HttpError(422, Object.values(siblingIssues)[0], { fields: siblingIssues });
  }
  const incomePatch = incomeFieldsPatch(
    { income, incomeCurrency, prefIncomeMin, prefIncomeCurrency },
    { income: member.income, incomeCurrency: member.incomeCurrency, prefIncomeMin: member.prefIncomeMin, prefIncomeCurrency: member.prefIncomeCurrency },
  );
  if (!incomePatch.ok) throw new HttpError(422, incomePatch.message, { fields: { [incomePatch.field]: incomePatch.message } });
  const nextCountry = (country ?? member.country ?? "IN").trim() || "IN";
  const countryChanged = country !== undefined && nextCountry !== (member.country || "IN");

  // Place of living is resolved as one thing, not field by field: the state, district and town have
  // to agree with each other and with the country, and outside India there is nothing below the
  // country to keep. Moving country drops whatever was stored below it rather than carrying a city
  // into a country it does not belong to; only values sent in this request are kept.
  const touchedPlace = country !== undefined || state !== undefined || district !== undefined || city !== undefined;
  const data: Record<string, unknown> = { ...rest, ...incomePatch.patch };
  if (country !== undefined) data.country = nextCountry;

  if (touchedPlace) {
    const carried = <T>(sent: T | undefined, stored: T | null) => (sent !== undefined ? sent : countryChanged ? null : stored);
    let input = {
      country: nextCountry,
      state: carried(state, member.state),
      district: carried(district, member.district),
      city: carried(city, member.city),
    };
    // An app build that has never heard of districts sends a free-typed city and no district. The
    // city it sent is then the only thing it is actually telling us about where they live, so it
    // decides the district — the stored one may well be what they are moving away from. The
    // district is filled in rather than the save refused, the same choice closed-lists.ts makes
    // for education.
    if (district === undefined && city !== undefined && input.city) {
      const legacy = resolveLegacyCity(input.city, input.state);
      if (legacy) input = { ...input, state: legacy.state, district: legacy.district, city: legacy.city };
    }
    // A client that knows about districts has to supply one for India — clearing it is refused —
    // while one that does not send the key at all is left to the legacy path above.
    let place = resolveLocation(input, { requireDistrict: district !== undefined });
    // ...and it must never be refused *because of* a district it cannot send. That happens when the
    // city it sent could not be resolved and the state it sent is not the stored district's state —
    // somebody on an old build moving from Ahilyanagar to a Gujarat village. Drop the stale
    // district instead of rejecting the save; they keep the city and state they actually sent.
    if (!place.ok && district === undefined && place.field === "district") {
      place = resolveLocation({ ...input, district: null });
    }
    if (!place.ok) throw new HttpError(422, place.message, { fields: { [place.field]: place.message } });
    data.state = place.value.state;
    data.district = place.value.district;
    data.city = place.value.city;
  }

  // Visa is part of living outside India. India clears it. Anywhere else, the
  // status is required. The expiry date is retired — see the note below.
  const touchingResidence = country !== undefined || visaType !== undefined || visaExpiry !== undefined;
  if (touchingResidence) {
    if (nextCountry === "IN") {
      data.visaType = null;
      data.visaExpiry = null;
    } else {
      const nextVisa = normalizeVisaType(visaType !== undefined ? visaType : member.visaType);
      if (!nextVisa || !(VISA_TYPES as readonly string[]).includes(nextVisa)) {
        throw new HttpError(422, "Choose your visa or status.", { fields: { visaType: "Choose your visa or status" } });
      }
      data.visaType = nextVisa;
      // The expiry date is retired: whatever an older app build sends is accepted and ignored.
    }
  }
  if (dob) data.dob = new Date(dob);
  if (prefCommunities !== undefined) data.prefCommunities = prefCommunities.join(",");
  if (prefCities !== undefined) data.prefCities = prefCities.join(",");
  if (prefEducation !== undefined) data.prefEducation = prefEducation.join(",");
  if (prefOccupation !== undefined) data.prefOccupation = prefOccupation.join(",");
  if (prefCountries !== undefined) data.prefCountries = prefCountries.join(",");

  const m = await prisma.member.update({ where: { id: me(req) }, data, include: includeTags });
  // A member typing a value that is not on a dropdown yet adds it to that list for everyone.
  await learnTagValuesFor(m.id, m);
  await activity(who(m), "UPDATED_PROFILE", "Member", m.id);
  res.json(await toSelf(await prisma.member.findUniqueOrThrow({ where: { id: m.id }, include: includeTags })));
}));

/**
 * "I have made the changes" — hands the bio data back for review.
 *
 * Correcting a profile is self-service: the member can already edit it, but
 * until now there was no way to say they were done, so a corrected profile sat
 * in the Correction queue until somebody happened to look. Moving it back to
 * PENDING puts it in the normal review queue, which is where the team works
 * from, and clears the note so a stale request is not shown next to a profile
 * that has already answered it.
 */
memberRouter.post("/resubmit", wrap(async (req, res) => {
  const m = await loadMe(me(req));
  if (m.status !== "CORRECTION") {
    throw new HttpError(409, "There is nothing waiting to be corrected.");
  }
  const updated = await prisma.member.update({
    where: { id: m.id },
    data: { status: "PENDING", adminNote: null },
    include: includeTags,
  });
  await activity(who(m), "RESUBMITTED", "Member", m.id);
  res.json(await toSelf(updated));
}));

/**
 * Every correction our team has asked this member for, newest first.
 *
 * Read back out of the audit log rather than kept on the member, because
 * adminNote only ever holds the latest one. Only the note and the date are
 * handed over: the stored detail also records who delivered it and whether the
 * email and SMS went through, which is ours, not theirs.
 */
memberRouter.get("/corrections", wrap(async (req, res) => {
  const rows = await prisma.auditLog.findMany({
    where: { entity: "Member", entityId: me(req), action: "REQUEST_CORRECTION" },
    orderBy: { createdAt: "desc" },
    select: { id: true, detail: true, createdAt: true },
  });
  res.json(
    rows
      .map((r) => ({ id: r.id, note: noteOf(r.detail), askedAt: r.createdAt }))
      .filter((r) => r.note),
  );
}));

/** The member-facing `note` out of an audit row's JSON detail, if it has one. */
function noteOf(detail: string | null): string {
  if (!detail) return "";
  try {
    const d = JSON.parse(detail) as { note?: unknown };
    return typeof d.note === "string" ? d.note : "";
  } catch {
    return "";
  }
}

memberRouter.get("/summary", wrap(async (req, res) => {
  const [notifications, announcements] = await Promise.all([
    prisma.notification.count({ where: { audience: "MEMBER", memberId: me(req), read: false } }),
    prisma.announcement.count({ where: { active: true } }),
  ]);
  res.json({ unreadNotifications: notifications, announcements });
}));

// ---------- Photos (member chooses which one is the main photo) ----------
memberRouter.post("/photos", photoUpload.array("photo", MAX_PHOTOS), wrap(async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw new HttpError(422, "Choose at least one photo to upload.");
  const have = await prisma.photo.count({ where: { memberId: me(req) } });
  if (have + files.length > MAX_PHOTOS) throw new HttpError(422, `You can keep up to ${MAX_PHOTOS} photos. Remove one to add another.`);
  const wantMain = String(req.body.mainIndex ?? "") !== "" ? Number(req.body.mainIndex) : -1;
  const keys = await Promise.all(files.map((f) => saveUpload("photos", f)));
  // Created one at a time so `createdAt` keeps the order they were picked in,
  // which is the order the gallery shows them in. syncMainPhoto settles which
  // one is main: the one asked for, else the existing main, else the oldest.
  const added = [];
  for (const key of keys) {
    added.push(await prisma.photo.create({ data: { memberId: me(req), url: key, isMain: false } }));
  }
  await syncMainPhoto(me(req), wantMain >= 0 ? added[wantMain]?.id : undefined);
  const m = await loadMe(me(req));
  await activity(who(m), "UPLOADED_PHOTOS", "Photo", undefined, { count: files.length });
  res.status(201).json((await toSelf(m)).photos);
}));

memberRouter.patch("/photos/:id/main", wrap(async (req, res) => {
  const p = await prisma.photo.findFirst({ where: { id: String(req.params.id), memberId: me(req) } });
  if (!p) throw new HttpError(404, "Photo not found.");
  await syncMainPhoto(me(req), p.id);
  const m = await loadMe(me(req));
  await activity(who(m), "CHANGED_MAIN_PHOTO", "Photo", p.id);
  res.json((await toSelf(m)).photos);
}));

memberRouter.delete("/photos/:id", wrap(async (req, res) => {
  const p = await prisma.photo.findFirst({ where: { id: String(req.params.id), memberId: me(req) } });
  if (!p) throw new HttpError(404, "Photo not found.");
  await prisma.photo.delete({ where: { id: p.id } });
  await removeObject(p.url);
  await syncMainPhoto(me(req));
  const m = await loadMe(me(req));
  await activity(who(m), "DELETED_PHOTO", "Photo", p.id);
  res.json((await toSelf(m)).photos);
}));

// ---------- Matches & profiles ----------
// Everything below needs an approved profile: a member waiting for review (or
// for a correction) has no access to anyone else's bio data, only to their own
// account. Liking and introductions were already gated; browsing was not.
memberRouter.get("/matches", requireApproved, wrap(async (req, res) => {
  const csv = z.string().optional().transform((v) => { const l = list(v); return l.length ? l : undefined; });
  const num = z.coerce.number().int().min(0).optional();
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(12),
    ageMin: num, ageMax: num, heightMin: num, heightMax: num,
    city: csv, maritalStatus: csv, education: csv, profession: csv, diet: csv, community: csv,
    subCommunity: csv, state: csv, district: csv, motherTongue: csv, familyType: csv, nativePlace: csv,
    country: csv,
    // One band from that currency's ladder. Omitted currency means INR. An unknown pair is ignored.
    incomeMin: z.string().trim().max(40).optional(),
    incomeCurrency: z.string().trim().max(8).optional(),
    hasPhoto: z.enum(["1", "true"]).optional().transform((v) => (v ? true : undefined)),
    justJoined: z.enum(["1", "true"]).optional().transform((v) => (v ? true : undefined)),
    nearby: z.enum(["1", "true"]).optional().transform((v) => (v ? true : undefined)),
    // "Indian" or "NRI": living in India, or living anywhere else.
    residence: z.enum(["india", "nri"]).optional(),
    code: z.string().trim().max(20).optional(),
    sort: z.enum(["new", "ageAsc", "ageDesc", "heightAsc", "heightDesc"]).optional(),
  }).parse(req.query);
  const { page: _p, pageSize: _s, ...filters } = q;
  const [mutual, likes, suggested] = await Promise.all([
    mutualIds(me(req)),
    prisma.like.findMany({ where: { likerId: me(req) }, select: { likedId: true } }),
    suggestionsFor(me(req)),
  ]);
  // Mutual matches are not part of the browse feed — they live in the Interests tab,
  // so feedPage() excludes them and every item here is a non-mutual profile.
  const { items, total } = await feedPage(me(req), filters, q.page, q.pageSize, mutual);
  const liked = new Set(likes.map((l) => l.likedId));
  /**
   * A profile our team suggested reads the same on every screen, the feed included: the page is
   * fetched in the short shape for egress, so the few suggested rows on it — normally none or
   * one — are read again in full and serialized through suggestedView. Without this a suggested
   * card was a tier-1 card until the member opened it, which is a second answer to the same
   * question about the same pair.
   */
  const onPage = items.filter((m) => suggested.has(m.id)).map((m) => m.id);
  const full = onPage.length
    ? new Map((await prisma.member.findMany({ where: { id: { in: onPage } }, select: mutualSelect })).map((m) => [m.id, m]))
    : new Map<string, MutualMember>();
  res.json({
    total, page: q.page, pageSize: q.pageSize,
    items: await Promise.all(items.map(async (m) => {
      const sug = full.get(m.id);
      return sug
        ? { ...(await suggestedView(sug)), liked: liked.has(m.id), mutual: false, suggested: true }
        : { ...(await toPublicProfile(m)), liked: liked.has(m.id), mutual: false, suggested: false };
    })),
  });
}));

memberRouter.get("/matches/filter-options", requireApproved, wrap(async (req, res) => {
  res.json(await filterOptionsFor(me(req)));
}));

/** A profile can be opened if it is in the viewer's curated feed, if the two members liked each other, or if our team suggested it. */
async function loadVisible(viewerId: string, profileId: string, isSuggested?: boolean) {
  const [isMutual, suggested] = await Promise.all([
    mutualIds(viewerId).then((ids) => ids.has(profileId)),
    // The caller passes what it already knows; otherwise it is one lookup here.
    isSuggested ?? prisma.suggestion.findUnique({ where: { viewerId_profileId: { viewerId, profileId } }, select: { id: true } }).then((r) => !!r),
  ]);
  const p = await visibleProfile(viewerId, profileId, isMutual || suggested);
  if (!p) throw new HttpError(404, "This profile is not available.");
  return { p, isMutual };
}

/**
 * Own-profile preview stays open while the bio data waits on our team: it is
 * the member's own data, and seeing how it will read to others is exactly what
 * they are meant to be doing in the meantime. Anyone else's profile needs an
 * approved account.
 */
const approvedUnlessSelf: RequestHandler = (req, res, next) =>
  String(req.params.id) === me(req) ? next() : requireApproved(req, res, next);

memberRouter.get("/profiles/:id", approvedUnlessSelf, wrap(async (req, res) => {
  const viewerId = me(req);
  const profileId = String(req.params.id);
  /** Own profile preview: full detail like a mutual view, but not a mutual *match*. */
  let p: Awaited<ReturnType<typeof loadVisible>>["p"];
  let isMutual: boolean;
  const isSelf = viewerId === profileId;
  // Looked up before the profile itself: a suggestion is what makes it openable
  // even when our team has hidden it from this viewer's feed since.
  const sug = isSelf ? null : await prisma.suggestion.findUnique({ where: { viewerId_profileId: { viewerId, profileId } } });
  const isSuggested = !!sug;
  if (isSelf) {
    const row = await prisma.member.findFirst({ where: { id: profileId }, select: mutualSelect });
    if (!row) throw new HttpError(404, "This profile is not available.");
    p = row;
    isMutual = false;
  } else {
    ({ p, isMutual } = await loadVisible(viewerId, profileId, isSuggested));
  }
  const [like, introByMe, introByThem] = await Promise.all([
    prisma.like.findUnique({ where: { likerId_likedId: { likerId: me(req), likedId: p.id } } }),
    prisma.introRequest.findUnique({ where: { requesterId_targetId: { requesterId: me(req), targetId: p.id } } }),
    prisma.introRequest.findUnique({ where: { requesterId_targetId: { requesterId: p.id, targetId: me(req) } } }),
  ]);
  const activeIntro = introByMe ?? introByThem;
  // A facilitated introduction unlocks nothing here: our team passes the
  // numbers between the families. What our team suggesting the profile unlocks
  // is in suggestedView — that is the team's own decision, not an automatic one.
  const revealFull = isMutual || isSelf || isSuggested;
  const serialized = revealFull ? await toMutualProfile(p) : await toPublicProfile(p);
  // Mobile number and email after our team approves this pair (admin: Likes & requests,
  // Mutual likes), or straight away on a profile our team suggested to this member.
  const contactApproved = !isSelf && (isSuggested || (isMutual && (await isContactShared(viewerId, p.id))));
  res.json({
    ...serialized,
    ...(!isSelf && (isMutual || isSuggested) ? { contactApproved, contact: contactApproved ? contactOf(p) : null, ...(contactApproved ? { fullName: p.fullName } : {}) } : {}),
    liked: isSelf ? false : !!like,
    mutual: isMutual,
    suggested: isSelf ? false : !!sug,
    suggestionNote: isSelf ? null : sug?.note ?? null,
    introduction: isSelf ? null : activeIntro ? { status: activeIntro.status, label: STATUS_LABEL[activeIntro.status] } : null,
  });
}));

// ---------- Likes ----------
memberRouter.put("/likes/:id", requireApproved, wrap(async (req, res) => {
  const { p } = await loadVisible(me(req), String(req.params.id));
  const existing = await prisma.like.findUnique({ where: { likerId_likedId: { likerId: me(req), likedId: p.id } } });
  let mutual = false;
  if (!existing) {
    await prisma.like.create({ data: { likerId: me(req), likedId: p.id } });
    const [meRow, them] = await Promise.all([
      prisma.member.findUniqueOrThrow({ where: { id: me(req) }, select: notifySelect }),
      prisma.member.findUniqueOrThrow({ where: { id: p.id }, select: notifySelect }),
    ]);
    await activity(who(meRow), "LIKED_PROFILE", "Member", p.id, { profile: p.profileCode });
    const back = await prisma.like.findUnique({ where: { likerId_likedId: { likerId: p.id, likedId: me(req) } } });
    if (back) {
      mutual = true;
      await prisma.$transaction([
        // the person who liked first
        prisma.notification.create({ data: { audience: "MEMBER", memberId: p.id, type: "MUTUAL_LIKE", title: "It's a match! 💞",
          body: `${meRow.profileCode} liked your profile as well. You can now view their profile properly.`, data: JSON.stringify({ memberId: meRow.id }) } }),
        // the person who just liked
        prisma.notification.create({ data: { audience: "MEMBER", memberId: meRow.id, type: "MUTUAL_LIKE", title: "It's a match! 💞",
          body: `${them.profileCode} had already liked you. You can now view their profile properly.`, data: JSON.stringify({ memberId: them.id }) } }),
        // staff bell
        prisma.notification.create({ data: { audience: "ADMIN", type: "MUTUAL_LIKE", title: "Mutual like",
          body: `${memberLabel(meRow)} and ${memberLabel(them)} liked each other.`, data: JSON.stringify({ a: meRow.id, b: them.id }) } }),
      ]);
      await activity(who(meRow), "MUTUAL_MATCH", "Member", p.id, { with: p.profileCode });
      // email + SMS to both people (each call is best-effort and never throws)
      await Promise.all([sendMutualMatch(meRow, them), sendMutualMatch(them, meRow)]);
      // push to both members — must be awaited before res.json() or Vercel kills the fn
      await Promise.allSettled([
        sendPush(meRow.fcmToken, "You have a new match! 💞", `You and ${them.profileCode} liked each other.`, { type: "MUTUAL_LIKE", memberId: them.id }),
        sendPush(them.fcmToken, "You have a new match! 💞", `You and ${meRow.profileCode} liked each other.`, { type: "MUTUAL_LIKE", memberId: meRow.id }),
      ]);
    } else {
      // not mutual yet — notify the liked person
      // memberId lets the app open the liker's profile from the notification.
      await sendPush(them.fcmToken, "Someone liked your profile! 💌", "Check who liked you on Sathsangath.", { type: "LIKE_RECEIVED", memberId: me(req) });
    }
  } else mutual = (await mutualIds(me(req))).has(p.id);
  res.json({ liked: true, mutual });
}));

memberRouter.delete("/likes/:id", requireApproved, wrap(async (req, res) => {
  const otherId = String(req.params.id);
  const r = await prisma.like.deleteMany({ where: { likerId: me(req), likedId: otherId } });
  if (r.count) {
    const m = await prisma.member.findUniqueOrThrow({ where: { id: me(req) }, select: { id: true, profileCode: true, fullName: true } });
    await activity(who(m), "REMOVED_LIKE", "Member", otherId);
    // Close any open intro requests between the two members (mutual access revoked)
    await prisma.introRequest.updateMany({
      where: {
        OR: [
          { requesterId: me(req), targetId: otherId },
          { requesterId: otherId, targetId: me(req) },
        ],
        status: { not: "CLOSED" },
      },
      data: { status: "CLOSED" },
    });
  }
  res.json({ liked: false });
}));

memberRouter.get("/likes/received", requireApproved, wrap(async (req, res) => {
  const shared = await sharedWith(me(req));
  const [likes, mutual, suggested] = await Promise.all([
    prisma.like.findMany({ where: { likedId: me(req), liker: { status: "APPROVED" } }, select: { likerId: true, createdAt: true, liker: { select: mutualSelect } }, orderBy: { createdAt: "desc" } }),
    mutualIds(me(req)),
    suggestionsFor(me(req)),
  ]);
  res.json(await Promise.all(likes.map(async (l) => {
    const isMutual = mutual.has(l.likerId); const isSuggested = suggested.has(l.likerId);
    // A profile our team suggested reads the same wherever it is listed, so the
    // suggested shape wins over the mutual one: it is a superset of it.
    const view = isSuggested ? await suggestedView(l.liker) : isMutual ? await mutualView(l.liker, shared) : await toPublicProfile(l.liker);
    return { ...view, liked: isMutual, mutual: isMutual, suggested: isSuggested, likedAt: l.createdAt };
  })));
}));

memberRouter.get("/likes", requireApproved, wrap(async (req, res) => {
  const shared = await sharedWith(me(req));
  const [likes, mutual, intros, suggested] = await Promise.all([
    prisma.like.findMany({ where: { likerId: me(req), liked: { status: "APPROVED" } }, select: { likedId: true, createdAt: true, liked: { select: mutualSelect } }, orderBy: { createdAt: "desc" } }),
    mutualIds(me(req)),
    prisma.introRequest.findMany({ where: { requesterId: me(req) }, select: { targetId: true, status: true } }),
    suggestionsFor(me(req)),
  ]);
  const byTarget = new Map(intros.map((i) => [i.targetId, i]));
  res.json(await Promise.all(likes.map(async (l) => {
    const i = byTarget.get(l.likedId); const isMutual = mutual.has(l.likedId); const isSuggested = suggested.has(l.likedId);
    const view = isSuggested ? await suggestedView(l.liked) : isMutual ? await mutualView(l.liked, shared) : await toPublicProfile(l.liked);
    return { ...view, liked: true, mutual: isMutual, suggested: isSuggested, likedAt: l.createdAt, introduction: i ? { status: i.status, label: STATUS_LABEL[i.status] } : null };
  })));
}));

/**
 * "Suggested by Sathsangath": profiles our team hand-picked for this member (newest first).
 * Every row is shown in full, contact details included — see suggestedView.
 */
memberRouter.get("/suggestions", requireApproved, wrap(async (req, res) => {
  const [rows, likes, mutual, intros] = await Promise.all([
    prisma.suggestion.findMany({ where: { viewerId: me(req), profile: { status: "APPROVED" } }, orderBy: { createdAt: "desc" }, select: { profileId: true, note: true, createdAt: true, profile: { select: mutualSelect } } }),
    prisma.like.findMany({ where: { likerId: me(req) }, select: { likedId: true } }),
    mutualIds(me(req)),
    prisma.introRequest.findMany({ where: { requesterId: me(req) }, select: { targetId: true, status: true } }),
  ]);
  const liked = new Set(likes.map((l) => l.likedId)); const byTarget = new Map(intros.map((i) => [i.targetId, i]));
  res.json(await Promise.all(rows.map(async (r) => {
    const isMutual = mutual.has(r.profileId); const i = byTarget.get(r.profileId);
    return { ...(await suggestedView(r.profile)), liked: liked.has(r.profileId), mutual: isMutual, suggested: true, suggestionNote: r.note, suggestedAt: r.createdAt, introduction: i ? { status: i.status, label: STATUS_LABEL[i.status] } : null };
  })));
}));

memberRouter.post("/introductions", requireApproved, wrap(async (req, res) => {
  const { profileId, message } = z.object({ profileId: z.string().min(1), message: z.string().trim().max(500).optional() }).parse(req.body);
  // Mutual like required before either member can request an introduction
  const mutual = await mutualIds(me(req));
  if (!mutual.has(profileId)) throw new HttpError(422, "You need a mutual like before requesting an introduction.");
  const existing = await prisma.introRequest.findUnique({ where: { requesterId_targetId: { requesterId: me(req), targetId: profileId } } });
  let r;
  if (!existing) {
    r = await prisma.introRequest.create({ data: { requesterId: me(req), targetId: profileId, message } });
  } else if (existing.status === "CLOSED") {
    // Re-open after a previous like-revoke cycle
    r = await prisma.introRequest.update({ where: { id: existing.id }, data: { status: "NEW", message: message ?? null } });
  } else {
    r = existing; // already active — idempotent
  }
  const m = await prisma.member.findUniqueOrThrow({ where: { id: me(req) }, select: { id: true, profileCode: true, fullName: true } });
  await activity(who(m), "REQUESTED_INTRODUCTION", "IntroRequest", r.id);
  res.status(201).json({ status: r.status, label: STATUS_LABEL[r.status] });
}));

// ---------- Notifications & announcements ----------
memberRouter.get("/notifications", wrap(async (req, res) => {
  res.json(await prisma.notification.findMany({ where: { audience: "MEMBER", memberId: me(req) }, orderBy: { createdAt: "desc" }, take: 100 }));
}));
memberRouter.post("/notifications/read-all", wrap(async (req, res) => {
  await prisma.notification.updateMany({ where: { audience: "MEMBER", memberId: me(req), read: false }, data: { read: true } });
  res.json({ ok: true });
}));
memberRouter.get("/announcements", wrap(async (_req, res) => {
  res.json(await prisma.announcement.findMany({ where: { active: true }, orderBy: { createdAt: "desc" }, take: 50 }));
}));
