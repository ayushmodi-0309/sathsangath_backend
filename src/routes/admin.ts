import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { sendPush } from "../lib/fcm";
import { HttpError, paging, wrap } from "../lib/http";
import { isOwner, normaliseRole, OWNER_ROLE, requireAdmin } from "../lib/auth";
import { includeTags } from "../lib/matching";
import { adminListSelect, toAdminListItem, toAdminMember } from "../lib/serializers";
import { learnTagValuesFor } from "../lib/tags";
import { audit, tempPassword } from "../lib/util";
import { areMutual, pair } from "../lib/contact-share";
import { sendApproved, sendCorrection, sendCredentials, sendRejection, sendSuggestion } from "../lib/notify";
import { config } from "../lib/config";
import multer from "multer";
import { createSubmission, DIETS, FAMILY_TYPES, INCOME_RANGES, intakeSchema, MARITAL_STATUSES, MAX_PHOTO_BYTES, normaliseBirthTime, RELOCATE } from "./public";
import { removeObject, resolveUrl, saveUpload } from "../lib/storage";
import { syncMainPhoto } from "../lib/photos";
import { checkAnyPhone, checkPhone, isCountry, type CountryCode } from "../lib/phone";

export const adminRouter = Router();
adminRouter.use(requireAdmin());
const adminId = (r: { actor?: { id: string } }) => r.actor!.id;
const pid = (v: unknown) => String(v);

// ---------- Dashboard ----------
adminRouter.get("/dashboard", wrap(async (_req, res) => {
  const [pending, correction, active, suspended, newRequests, likes, messages, mutualNew, recentLikes, recentPending] = await Promise.all([
    prisma.member.count({ where: { status: "PENDING" } }),
    prisma.member.count({ where: { status: "CORRECTION" } }),
    prisma.member.count({ where: { status: "APPROVED" } }),
    prisma.member.count({ where: { status: "SUSPENDED" } }),
    prisma.introRequest.count({ where: { status: "NEW" } }),
    prisma.like.count(),
    prisma.contactMessage.count({ where: { handled: false } }),
    prisma.notification.count({ where: { audience: "ADMIN", read: false } }),
    prisma.like.findMany({ take: 6, orderBy: { createdAt: "desc" }, include: { liker: { select: { profileCode: true, fullName: true } }, liked: { select: { profileCode: true } } } }),
    prisma.member.findMany({ where: { status: "PENDING" }, take: 6, orderBy: { createdAt: "desc" }, select: { id: true, profileCode: true, fullName: true, gender: true, city: true, createdAt: true } }),
  ]);
  res.json({ counts: { pending, correction, active, suspended, newRequests, likes, messages, mutualNew }, recentLikes, recentPending });
}));

// ---------- Members / submissions ----------
const tri = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const listQuery = z.object({
  // existing
  status: z.string().optional(), q: z.string().trim().optional(), gender: z.string().optional(),
  city: z.string().optional(), community: z.string().optional(), tag: z.string().optional(),
  ageMin: z.coerce.number().int().min(0).optional(), ageMax: z.coerce.number().int().min(0).optional(),
  // new
  maritalStatus: z.string().optional(),
  heightMin: z.coerce.number().int().min(0).optional(),
  heightMax: z.coerce.number().int().min(0).optional(),
  education: z.string().optional(),
  profession: z.string().optional(),
  income: z.string().optional(),
  diet: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  nativePlace: z.string().optional(),
  birthPlace: z.string().optional(),
  religion: z.string().optional(),
  motherTongue: z.string().optional(),
  familyType: z.string().optional(),
  subCommunity: z.string().optional(),
  source: z.string().optional(),
  createdBy: z.string().optional(),
  hasPhoto: z.enum(["true", "false"]).optional(),
  hasIdProof: z.enum(["true", "false"]).optional(),
  hasAccount: z.enum(["true", "false"]).optional(),
  expiringSoon: z.enum(["true"]).optional(),
  plan: z.enum(["FREE", "DIKRI", "DIKRA", "SIGNATURE", "BASIC", "PRO"]).optional(),
  // pagination + sort
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["profileCode","fullName","dob","city","community","status","createdAt","maritalStatus","heightCm","education","profession","state","country","religion","motherTongue","familyType","source"]).default("createdAt"),
  order: z.enum(["asc","desc"]).default("desc"),
});

/** Comma-separated filter values → match any (OR). Single value stays on `w` for a simpler query plan. */
function applyMultiContains(
  w: Prisma.MemberWhereInput,
  and: Prisma.MemberWhereInput[],
  field: "city" | "community" | "subCommunity",
  raw?: string,
) {
  if (!raw) return;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return;
  if (parts.length === 1) {
    w[field] = { contains: parts[0], mode: "insensitive" };
  } else {
    and.push({ OR: parts.map((p) => ({ [field]: { contains: p, mode: "insensitive" } })) });
  }
}

function buildWhere(q: z.infer<typeof listQuery>): Prisma.MemberWhereInput {
  const w: Prisma.MemberWhereInput = {};
  const and: Prisma.MemberWhereInput[] = [];
  if (q.status) w.status = q.status;
  if (q.gender) w.gender = q.gender;
  applyMultiContains(w, and, "city", q.city);
  applyMultiContains(w, and, "community", q.community);
  applyMultiContains(w, and, "subCommunity", q.subCommunity);
  if (q.tag) w.tags = { some: { tagValueId: q.tag } };
  if (q.q) and.push({ OR: [{ fullName: { contains: q.q, mode: "insensitive" } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: "insensitive" } }, { profileCode: { contains: q.q, mode: "insensitive" } }] });
  const now = new Date();
  if (q.ageMin) w.dob = { ...(w.dob as object), lte: new Date(now.getFullYear() - q.ageMin, now.getMonth(), now.getDate()) };
  if (q.ageMax) w.dob = { ...(w.dob as object), gte: new Date(now.getFullYear() - q.ageMax - 1, now.getMonth(), now.getDate()) };
  // new
  if (q.maritalStatus) w.maritalStatus = q.maritalStatus;
  if (q.heightMin) w.heightCm = { ...(w.heightCm as object), gte: q.heightMin };
  if (q.heightMax) w.heightCm = { ...(w.heightCm as object), lte: q.heightMax };
  if (q.education)    w.education = { contains: q.education, mode: "insensitive" };
  if (q.profession)   w.profession = { contains: q.profession, mode: "insensitive" };
  if (q.income)       w.income = { contains: q.income, mode: "insensitive" };
  if (q.diet)         w.diet = q.diet;
  if (q.state)        w.state = { contains: q.state, mode: "insensitive" };
  if (q.country)      w.country = q.country;
  if (q.nativePlace)  w.nativePlace = { contains: q.nativePlace, mode: "insensitive" };
  if (q.birthPlace)   w.birthPlace = { contains: q.birthPlace, mode: "insensitive" };
  if (q.religion)     w.religion = { contains: q.religion, mode: "insensitive" };
  if (q.motherTongue) w.motherTongue = { contains: q.motherTongue, mode: "insensitive" };
  if (q.familyType)   w.familyType = q.familyType;
  if (q.source)       w.source = q.source;
  if (q.createdBy)    w.createdBy = q.createdBy;
  if (q.hasPhoto === "true")  w.photoUrl = { not: null };
  if (q.hasPhoto === "false") w.photoUrl = null;
  if (q.hasIdProof === "true")  w.idProofUrl = { not: null };
  if (q.hasIdProof === "false") w.idProofUrl = null;
  if (q.hasAccount === "true")  w.accountId = { not: null };
  if (q.hasAccount === "false") w.accountId = null;
  if (q.expiringSoon === "true") {
    const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    w.membershipPlans = { some: { endDate: { lte: in30, gte: new Date() } } };
  }
  const running = { startDate: { lte: new Date() }, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] }; // started and not ended (no end date = open-ended)
  if (q.plan === "FREE") w.membershipPlans = { none: running };
  if (q.plan && q.plan !== "FREE") w.membershipPlans = { some: { plan: q.plan, ...running } };
  if (and.length) w.AND = and;
  return w;
}
void tri; // suppress unused warning — may be used in future

adminRouter.get("/members", wrap(async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = buildWhere(q);
  const [total, rows] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.findMany({ where, select: adminListSelect, orderBy: { [q.sort]: q.order } as Record<string, "asc"|"desc">, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({ total, page: q.page, pageSize: q.pageSize, sort: q.sort, order: q.order, items: rows.map(toAdminListItem) });
}));

adminRouter.get("/members/export.csv", wrap(async (req, res) => {
  const rows = await prisma.member.findMany({ where: buildWhere(listQuery.parse(req.query)), include: includeTags, orderBy: { createdAt: "desc" } });
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`; };
  const head = ["Profile","Status","Name","Gender","Age","Phone","Email","Community","City","Education","Profession","Tags","Submitted"];
  const admins = await Promise.all(rows.map(toAdminMember));
  const lines = admins.map((a) => { return [a.profileCode, a.status, a.fullName, a.gender, a.age, a.phone, a.email, a.community, a.city, a.education, a.profession, a.tags.map((t) => `${t.category}:${t.value}`).join("; "), a.createdAt.toISOString()].map(esc).join(","); });
  await audit(adminId(req), "EXPORT", "Member", undefined, { count: rows.length });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="sathsangath-members.csv"');
  res.send("﻿" + [head.join(","), ...lines].join("\r\n"));
}));

adminRouter.get("/members/:id", wrap(async (req, res) => {
  const m = await prisma.member.findUnique({ where: { id: pid(req.params.id) }, include: includeTags });
  if (!m) throw new HttpError(404, "Member not found.");
  const profileSnap = { id: true, profileCode: true, fullName: true, city: true, status: true, photoUrl: true } as const;
  const [likesGiven, likesReceivedList, intros, introsReceived, overrides, suggestions] = await Promise.all([
    prisma.like.findMany({ where: { likerId: m.id }, orderBy: { createdAt: "desc" }, include: { liked: { select: profileSnap } } }),
    prisma.like.findMany({ where: { likedId: m.id }, orderBy: { createdAt: "desc" }, include: { liker: { select: profileSnap } } }),
    prisma.introRequest.findMany({ where: { requesterId: m.id }, orderBy: { createdAt: "desc" }, include: { target: { select: profileSnap } } }),
    prisma.introRequest.findMany({ where: { targetId: m.id }, orderBy: { createdAt: "desc" }, include: { requester: { select: profileSnap } } }),
    prisma.visibilityOverride.findMany({ where: { viewerId: m.id }, include: { profile: { select: { id: true, profileCode: true, fullName: true } } } }),
    prisma.suggestion.findMany({ where: { viewerId: m.id }, orderBy: { createdAt: "desc" }, include: { profile: { select: { id: true, profileCode: true, fullName: true, gender: true, city: true, photoUrl: true } } } }),
  ]);
  // Compute "liked back" flags for each suggestion without N+1 queries
  const sugProfileIds = suggestions.map((s) => s.profileId);
  const [viewerLikedSet, profileLikedSet] = sugProfileIds.length ? await Promise.all([
    prisma.like.findMany({ where: { likerId: m.id, likedId: { in: sugProfileIds } }, select: { likedId: true } }).then((r) => new Set(r.map((x) => x.likedId))),
    prisma.like.findMany({ where: { likerId: { in: sugProfileIds }, likedId: m.id }, select: { likerId: true } }).then((r) => new Set(r.map((x) => x.likerId))),
  ]) : [new Set<string>(), new Set<string>()];
  const suggestionsWithFlags = suggestions.map((s) => ({ ...s, viewerLiked: viewerLikedSet.has(s.profileId), profileLiked: profileLikedSet.has(s.profileId) }));
  // Snapshot photoUrl values come straight out of the database as storage object
  // keys ("photos/<id>/<hash>.jpg"); the browser cannot load those, so every
  // snapshot that goes out is signed first, the same way toAdminMember signs the
  // member's own photo. One cache signs a repeated profile only once.
  const signed = new Map<string, Promise<string | null>>();
  const snap = async <T extends { photoUrl: string | null }>(p: T | null | undefined) => {
    if (!p) return p;
    if (!p.photoUrl) return p;
    let u = signed.get(p.photoUrl);
    if (!u) { u = resolveUrl(p.photoUrl); signed.set(p.photoUrl, u); }
    return { ...p, photoUrl: await u };
  };
  const [gaveTo, gotFrom, introsOut, introsIn, sugOut] = await Promise.all([
    Promise.all(likesGiven.map(async (l) => ({ ...l, liked: await snap(l.liked) }))),
    Promise.all(likesReceivedList.map(async (l) => ({ ...l, liker: await snap(l.liker) }))),
    Promise.all(intros.map(async (i) => ({ ...i, target: await snap(i.target) }))),
    Promise.all(introsReceived.map(async (i) => ({ ...i, requester: await snap(i.requester) }))),
    Promise.all(suggestionsWithFlags.map(async (s) => ({ ...s, profile: (await snap(s.profile))! }))),
  ]);
  res.json({ ...(await toAdminMember(m)), likesGiven: gaveTo, likesReceivedList: gotFrom, likesReceived: gotFrom.length, intros: introsOut, introsReceived: introsIn, overrides, suggestions: sugOut });
}));

// Manual entry by admin (walk-in / phone enquiry): same fields and file rules as the public form, lands as PENDING.
const ADMIN_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const adminUpload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_r, f, cb) => (ADMIN_ALLOWED.has(f.mimetype) ? cb(null, true) : cb(new HttpError(422, "Only JPG, PNG, WebP or PDF files are allowed."))),
});
adminRouter.post("/members", adminUpload.fields([{ name: "photo", maxCount: 3 }, { name: "biodata", maxCount: 1 }, { name: "idproof", maxCount: 1 }]), wrap(async (req, res) => {
  let dobIsApproximate = false;
  const body = { ...req.body, consent: true };
  if (!body.dob && body.age) {
    const age = parseInt(body.age, 10);
    if (!isNaN(age) && age >= 18 && age <= 80) {
      body.dob = `${new Date().getFullYear() - age}-07-01`;
      dobIsApproximate = true;
    } else {
      throw new HttpError(422, "Enter a valid age (18–80).", { fields: { age: "Enter a valid age between 18 and 80" } });
    }
  }
  const input = intakeSchema.parse(body);
  const f = req.files as Record<string, Express.Multer.File[]> | undefined;
  const photos = f?.photo ?? [];
  const big = photos.find((p) => p.size > MAX_PHOTO_BYTES || !p.mimetype.startsWith("image/"));
  if (big) throw new HttpError(422, "Photos must be JPG, PNG or WebP and 5 MB or smaller.", { fields: { photos: "Photos must be JPG, PNG or WebP and 5 MB or smaller" } });
  if (f?.idproof?.[0] && !input.idProofType) throw new HttpError(422, "Choose the type of ID proof.", { fields: { idProofType: "Choose the type of ID proof" } });
  const photoUrls: string[] = [];
  let biodataFileUrl: string | undefined, idProofUrl: string | undefined;
  try {
    for (const p of photos) photoUrls.push(await saveUpload("photos", p));
    if (f?.biodata?.[0]) biodataFileUrl = await saveUpload("docs", f.biodata[0]);
    if (f?.idproof?.[0]) idProofUrl = await saveUpload("docs", f.idproof[0]);
    const m = await createSubmission(input, "ADMIN", { photoUrls, biodataFileUrl, idProofUrl }, undefined, dobIsApproximate);
    await audit(adminId(req), "CREATE", "Member", m.id);
    res.status(201).json({ id: m.id, profileCode: m.profileCode });
  } catch (e) {
    await Promise.all([...photoUrls.map((u) => removeObject(u)), removeObject(biodataFileUrl), removeObject(idProofUrl)]); // e.g. duplicate phone: don't orphan files
    throw e;
  }
}));

/**
 * A whole-number field on the edit routes. PUT /members/:id is multipart, so every value arrives as
 * a string ("173"), which a bare z.number() rejects: these coerce instead. An absent key stays
 * undefined (leave the column alone) while "" or null means null (clear it).
 */
const intEdit = (min: number, max: number) => z.preprocess(
  (v) => (v === undefined ? undefined : v === "" || v === null ? null : Number(v)),
  z.number().int().min(min).max(max).nullable().optional(),
);

/**
 * Puts a phone number through the same check the intake form uses, so an edit can never store a
 * number the API would have rejected on submission.
 *
 * This matters because the stored format is not what the form field holds: India keeps a bare
 * 10-digit number while every other country is stored as +<dial><national>. Writing the field
 * straight through dropped the "+" and corrupted every non-Indian number.
 */
function normalisedPhone(raw: string, country: CountryCode, field: "phone" | "familyPhone"): string {
  const r = checkPhone(raw, country);
  if (!r.ok) throw new HttpError(422, r.error, { fields: { [field]: r.error } });
  return r.value;
}

/** Same tolerant normalising the intake form does, but nullable so the admin can clear the field. */
const birthTimeEdit = z.union([
  z.null(),
  z.literal("").transform(() => null),
  z.string().trim().transform((v, ctx) => {
    const t = normaliseBirthTime(v);
    if (!t) { ctx.addIssue({ code: "custom", message: "Enter the birth time as HH:MM, for example 08:36 or 8:36 PM" }); return z.NEVER; }
    return t;
  }),
]);

/**
 * A preference list on the edit routes.
 *
 * The edit form appends one FormData entry per value, and Express parses a lone entry as a plain
 * string rather than a one-item array, so a member with exactly one preferred community, city,
 * education, occupation or country could not be saved at all: the whole PUT failed with
 * "expected array, received string". Accept either shape, and treat a comma-separated string the
 * way the intake form does. An absent key stays undefined so the stored list is left alone.
 */
const prefList = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return v;
  return v.trim() ? v.split(",").map((x) => x.trim()).filter(Boolean) : [];
}, z.array(z.string().trim()).optional());

/**
 * An optional text field on the edit routes. Clearing one in the admin form sends "", which should
 * null the column rather than store an empty string, so the field reads as unset everywhere.
 */
const clearableText = z.preprocess((v) => (v === "" ? null : v), z.string().trim().nullable());
/** An optional fixed-choice field: one of `vals`, or "" / null to clear it. */
const clearableChoice = <T extends readonly [string, ...string[]]>(vals: T) =>
  z.preprocess((v) => (v === "" ? null : v), z.union([z.null(), z.enum(vals)]));

const editSchema = z.object({
  fullName: z.string().trim().min(2), phone: z.string().trim(), email: clearableText,
  familyPhone: clearableText, familyEmail: clearableText,
  gender: z.enum(["MALE", "FEMALE"]), heightCm: intEdit(120, 250),
  maritalStatus: z.string().trim().pipe(z.enum(MARITAL_STATUSES, { message: "Select marital status" })),
  weightKg: intEdit(30, 250), birthTime: birthTimeEdit, birthPlace: clearableText,
  community: clearableText, subCommunity: clearableText, city: clearableText, state: clearableText,
  education: clearableText, profession: clearableText,
  income: clearableChoice(INCOME_RANGES), diet: clearableChoice(DIETS),
  fatherOccupation: clearableText, motherOccupation: clearableText, siblings: clearableText,
  familyBackground: clearableText, about: clearableText, prefAgeMin: intEdit(18, 80), prefAgeMax: intEdit(18, 80),
  prefNotes: clearableText, adminNote: clearableText,
  motherTongue: clearableText, fatherName: clearableText, motherName: clearableText, createdBy: clearableText,
  familyType: clearableChoice(FAMILY_TYPES),
  nativePlace: clearableText, prefHeightMinCm: intEdit(120, 250),
  prefMaritalStatus: clearableChoice(MARITAL_STATUSES), prefRelocate: clearableChoice(RELOCATE),
  prefCommunities: prefList, prefCities: prefList,
  prefEducation: prefList, prefOccupation: prefList, prefCountries: prefList,
  prefIncomeMin: clearableChoice(INCOME_RANGES),
  visaType: clearableText, visaExpiry: clearableText,
}).partial().superRefine((v, ctx) => {
  // Same rule the public form enforces: an inverted preferred age range is a mistake.
  if (v.prefAgeMin != null && v.prefAgeMax != null && v.prefAgeMin > v.prefAgeMax) {
    ctx.addIssue({ code: "custom", path: ["prefAgeMax"], message: "The maximum age must be more than the minimum age" });
  }
});

/** Admin edit of the visa expiry: undefined = untouched, null = cleared, Date = new value. */
function visaExpiryValue(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new HttpError(422, "Enter a valid visa expiry date.", { fields: { visaExpiry: "Enter a valid expiry date" } });
  return d;
}

adminRouter.patch("/members/:id", wrap(async (req, res) => {
  const { prefCommunities, prefCities, prefEducation, prefOccupation, prefCountries, visaExpiry, ...d } = editSchema.parse(req.body);
  const visaExpiryPatch = visaExpiryValue(visaExpiry);
  // This route carries no country field, so the number's own +dialcode decides it (else India).
  for (const field of ["phone", "familyPhone"] as const) {
    const raw = d[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const r = checkAnyPhone(raw);
    if (!r.ok) throw new HttpError(422, r.error, { fields: { [field]: r.error } });
    d[field] = r.value;
  }
  const m = await prisma.member.update({
    where: { id: pid(req.params.id) },
    data: {
      ...d,
      ...(visaExpiryPatch !== undefined && { visaExpiry: visaExpiryPatch }),
      ...(prefCommunities !== undefined && { prefCommunities: prefCommunities.join(",") }),
      ...(prefCities !== undefined && { prefCities: prefCities.join(",") }),
      ...(prefEducation !== undefined && { prefEducation: prefEducation.join(",") }),
      ...(prefOccupation !== undefined && { prefOccupation: prefOccupation.join(",") }),
      ...(prefCountries !== undefined && { prefCountries: prefCountries.join(",") }),
    },
    include: includeTags,
  });
  // An admin typing a value that is not on a dropdown yet adds it to that list for everyone.
  await learnTagValuesFor(m.id, m);
  await audit(adminId(req), "EDIT", "Member", m.id, { fields: Object.keys(req.body) });
  res.json(await toAdminMember(await prisma.member.findUniqueOrThrow({ where: { id: m.id }, include: includeTags })));
}));

// Full edit (multipart) — same as PATCH but also handles DOB/age toggle and file uploads.
const fullEditSchema = editSchema.extend({
  dob: z.string().optional().or(z.literal("").transform(() => undefined)),
  age: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(18).max(80).optional()),
  dobIsApproximate: z.preprocess((v) => v === true || v === "true" || v === "1", z.boolean()).optional(),
  country: z.string().trim().optional(),
  idProofType: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  phoneCountry: z.string().trim().optional(),
  familyPhoneCountry: z.string().trim().optional(),
});

adminRouter.put("/members/:id", adminUpload.fields([{ name: "photo", maxCount: 3 }, { name: "biodata", maxCount: 1 }, { name: "idproof", maxCount: 1 }]), wrap(async (req, res) => {
  const id = pid(req.params.id);
  let dobIsApproximate: boolean | undefined;
  const body = { ...req.body };
  if (!body.dob && body.age) {
    const age = parseInt(body.age, 10);
    if (!isNaN(age) && age >= 18 && age <= 80) {
      body.dob = `${new Date().getFullYear() - age}-07-01`;
      dobIsApproximate = true;
    } else {
      throw new HttpError(422, "Enter a valid age (18–80).", { fields: { age: "Enter a valid age between 18 and 80" } });
    }
  } else if (body.dob) {
    dobIsApproximate = false;
  }
  const { prefCommunities, prefCities, prefEducation, prefOccupation, prefCountries, dob, age: _age, country, phoneCountry, familyPhoneCountry, visaExpiry, ...d } = fullEditSchema.parse(body);
  void _age;
  const visaExpiryPatch = visaExpiryValue(visaExpiry);
  // Normalise both numbers before they are written. Falls back to the member's residence country
  // when the form did not say which country the number was typed under.
  const residence = await prisma.member.findUniqueOrThrow({ where: { id }, select: { country: true } });
  const home = (isCountry(country) ? country : isCountry(residence.country) ? residence.country : "IN") as CountryCode;
  if (typeof d.phone === "string" && d.phone.trim()) {
    d.phone = normalisedPhone(d.phone, isCountry(phoneCountry) ? phoneCountry : home, "phone");
  }
  if (typeof d.familyPhone === "string" && d.familyPhone.trim()) {
    d.familyPhone = normalisedPhone(d.familyPhone, isCountry(familyPhoneCountry) ? familyPhoneCountry : isCountry(phoneCountry) ? phoneCountry : home, "familyPhone");
  }
  const f = req.files as Record<string, Express.Multer.File[]> | undefined;
  const newPhotos = f?.photo ?? [];
  const big = newPhotos.find((p) => p.size > MAX_PHOTO_BYTES || !p.mimetype.startsWith("image/"));
  if (big) throw new HttpError(422, "Photos must be JPG, PNG or WebP and 5 MB or smaller.", { fields: { photos: "Photos must be JPG, PNG or WebP and 5 MB or smaller" } });
  const uploadedPhotoUrls: string[] = [];
  let biodataFileUrl: string | undefined, idProofUrl: string | undefined, newMainUrl: string | undefined;
  try {
    for (const p of newPhotos) uploadedPhotoUrls.push(await saveUpload("photos", p));
    // The new photo chosen as main (mainPhotoIndex), else the first one only when the member has no main photo yet.
    const idx = Number.parseInt(String(req.body.mainPhotoIndex ?? ""), 10);
    const hasMain = (await prisma.photo.count({ where: { memberId: pid(req.params.id), isMain: true } })) > 0;
    newMainUrl = uploadedPhotoUrls[Number.isInteger(idx) && idx >= 0 && idx < uploadedPhotoUrls.length ? idx : hasMain ? -1 : 0];
    if (f?.biodata?.[0]) biodataFileUrl = await saveUpload("docs", f.biodata[0]);
    if (f?.idproof?.[0]) idProofUrl = await saveUpload("docs", f.idproof[0]);
    const m = await prisma.member.update({
      where: { id },
      data: {
        ...d,
        ...(visaExpiryPatch !== undefined && { visaExpiry: visaExpiryPatch }),
        ...(dob !== undefined && { dob: new Date(dob) }),
        ...(dobIsApproximate !== undefined && { dobIsApproximate }),
        ...(country && { country }),
        ...(prefCommunities !== undefined && { prefCommunities: prefCommunities.join(",") }),
        ...(prefCities !== undefined && { prefCities: prefCities.join(",") }),
        ...(prefEducation !== undefined && { prefEducation: prefEducation.join(",") }),
        ...(prefOccupation !== undefined && { prefOccupation: prefOccupation.join(",") }),
        ...(prefCountries !== undefined && { prefCountries: prefCountries.join(",") }),
        ...(biodataFileUrl && { biodataFileUrl }),
        ...(idProofUrl && { idProofUrl }),
        ...(newMainUrl && { photoUrl: newMainUrl }),
        ...(uploadedPhotoUrls.length && { photos: { ...(newMainUrl && { updateMany: { where: { isMain: true }, data: { isMain: false } } }), create: uploadedPhotoUrls.map((url) => ({ url, isMain: url === newMainUrl })) } }),
      },
      include: includeTags,
    });
    if (uploadedPhotoUrls.length) await syncMainPhoto(m.id);
    await audit(adminId(req), "EDIT", "Member", m.id, { fields: Object.keys(req.body) });
    res.json(await toAdminMember(uploadedPhotoUrls.length ? await prisma.member.findUniqueOrThrow({ where: { id: m.id }, include: includeTags }) : m));
  } catch (e) {
    await Promise.all([...uploadedPhotoUrls.map((u) => removeObject(u)), removeObject(biodataFileUrl), removeObject(idProofUrl)]);
    throw e;
  }
}));

// ---------- Photos ----------
// Our team manages a member's photos alongside their bio data: a family often
// sends them over WhatsApp, and the member may never open the app. Adding is
// part of PUT /members/:id; these two are the rest of the job. A member can do
// the same from their own account, and syncMainPhoto keeps both honest: one
// main photo, with Member.photoUrl pointing at it.

/** The photo, checked to belong to that member — so one member's id cannot reach another's photo. */
async function photoOf(memberId: string, photoId: string) {
  const p = await prisma.photo.findFirst({ where: { id: photoId, memberId } });
  if (!p) throw new HttpError(404, "Photo not found.");
  return p;
}

adminRouter.patch("/members/:id/photos/:photoId/main", wrap(async (req, res) => {
  const id = pid(req.params.id);
  const p = await photoOf(id, pid(req.params.photoId));
  await syncMainPhoto(id, p.id);
  // Against the member, not the photo: GET /members/:id/history looks for
  // admin rows by entity "Member", so anything else is invisible there.
  await audit(adminId(req), "CHANGED_MAIN_PHOTO", "Member", id, { photo: p.id });
  const m = await prisma.member.findUniqueOrThrow({ where: { id }, include: includeTags });
  res.json(await toAdminMember(m));
}));

adminRouter.delete("/members/:id/photos/:photoId", wrap(async (req, res) => {
  const id = pid(req.params.id);
  const p = await photoOf(id, pid(req.params.photoId));
  await prisma.photo.delete({ where: { id: p.id } });
  // The row is gone either way: an object left behind in storage is tidier to
  // chase than a photo the member can still be shown but no longer delete.
  await removeObject(p.url);
  await syncMainPhoto(id);
  await audit(adminId(req), "DELETED_PHOTO", "Member", id, { photo: p.id });
  const m = await prisma.member.findUniqueOrThrow({ where: { id }, include: includeTags });
  res.json(await toAdminMember(m));
}));

// ---------- Review workflow ----------
async function issueCredentials(id: string) {
  const pw = tempPassword();
  const m = await prisma.member.update({ where: { id }, data: { passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: true } });
  return sendCredentials(m, pw); // { email, sms }: "sent" | "failed" | "no-address" | "not-configured"
}

adminRouter.post("/members/:id/approve", wrap(async (req, res) => {
  const { tagIds } = z.object({ tagIds: z.array(z.string()).default([]) }).parse(req.body ?? {});
  const id = pid(req.params.id);
  const cur = await prisma.member.findUnique({ where: { id } });
  if (!cur) throw new HttpError(404, "Member not found.");
  await prisma.$transaction([
    prisma.memberTag.deleteMany({ where: { memberId: id } }),
    ...tagIds.map((t) => prisma.memberTag.create({ data: { memberId: id, tagValueId: t } })),
    prisma.member.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), adminNote: null } }),
  ]);
  const delivery = cur.accountId ? await sendApproved(cur) : cur.passwordHash ? undefined : await issueCredentials(id);
  await audit(adminId(req), "APPROVE", "Member", id, { tagIds, delivery });
  res.json({ ok: true, delivery });
}));

adminRouter.post("/members/:id/correction", wrap(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(5, "Tell the member what to correct") }).parse(req.body);
  const m = await prisma.member.update({ where: { id: pid(req.params.id) }, data: { status: "CORRECTION", adminNote: note } });
  const delivery = await sendCorrection(m, note);
  // Email and SMS are easy to miss; the app can act on it directly. The note
  // itself is the body, so the member sees what to change on the lock screen.
  await sendPush(m.fcmToken, "A correction is needed", note, { type: "CORRECTION" });
  await audit(adminId(req), "REQUEST_CORRECTION", "Member", m.id, { note, delivery });
  res.json({ ok: true, delivery });
}));

adminRouter.post("/members/:id/reject", wrap(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(5, "Add a short reason") }).parse(req.body);
  const m = await prisma.member.update({ where: { id: pid(req.params.id) }, data: { status: "REJECTED", adminNote: note } });
  const delivery = await sendRejection(m);
  await audit(adminId(req), "REJECT", "Member", m.id, { note, delivery });
  res.json({ ok: true, delivery });
}));

// Allowed from any status, not just APPROVED: a profile still under review (or already rejected)
// can equally need locking out. What it was before is remembered by approvedAt, which /reactivate reads.
adminRouter.post("/members/:id/suspend", wrap(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().optional() }).parse(req.body ?? {});
  const id = pid(req.params.id);
  const cur = await prisma.member.findUnique({ where: { id }, select: { status: true } });
  if (!cur) throw new HttpError(404, "Member not found.");
  if (cur.status === "SUSPENDED") throw new HttpError(409, "This profile is already suspended.");
  await prisma.member.update({ where: { id }, data: { status: "SUSPENDED", adminNote: note } });
  await audit(adminId(req), "SUSPEND", "Member", id, { note, from: cur.status });
  res.json({ ok: true });
}));
// Undo an approval made by mistake: back to PENDING (hidden from matching, re-reviewable). Unlike suspend, the member is not locked out as an account.
adminRouter.post("/members/:id/restrict", wrap(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().optional() }).parse(req.body ?? {});
  const id = pid(req.params.id);
  const cur = await prisma.member.findUnique({ where: { id }, select: { status: true } });
  if (!cur) throw new HttpError(404, "Member not found.");
  if (cur.status !== "APPROVED") throw new HttpError(409, "Only an approved profile can be restricted.");
  await prisma.member.update({ where: { id }, data: { status: "PENDING", approvedAt: null, adminNote: null } });
  await audit(adminId(req), "RESTRICT", "Member", id, { note });
  res.json({ ok: true });
}));
// Lifting a suspension puts the profile back where it was, which is not always APPROVED: a
// profile can be suspended while it is still waiting for review, and reactivating it must not
// approve it by the back door. approvedAt is the record of whether it ever passed review
// (/restrict clears it), so a profile that never did goes back to PENDING for a real review.
adminRouter.post("/members/:id/reactivate", wrap(async (req, res) => {
  const id = pid(req.params.id);
  const cur = await prisma.member.findUnique({ where: { id }, select: { status: true, approvedAt: true } });
  if (!cur) throw new HttpError(404, "Member not found.");
  if (cur.status !== "SUSPENDED") throw new HttpError(409, "Only a suspended profile can be reactivated.");
  const status = cur.approvedAt ? "APPROVED" : "PENDING";
  await prisma.member.update({ where: { id }, data: { status, adminNote: null } });
  await audit(adminId(req), "REACTIVATE", "Member", id, { status });
  res.json({ ok: true, status });
}));
adminRouter.post("/members/:id/resend-credentials", wrap(async (req, res) => {
  const delivery = await issueCredentials(pid(req.params.id));
  await audit(adminId(req), "RESEND_CREDENTIALS", "Member", pid(req.params.id), { delivery });
  res.json({ ok: true, delivery });
}));
// Generate a new temp password and return it in plaintext so the admin can share it manually.
// Does NOT send any email/SMS — the admin decides how to deliver it.
adminRouter.post("/members/:id/reset-password", wrap(async (req, res) => {
  const id = pid(req.params.id);
  const pw = tempPassword();
  await prisma.member.update({ where: { id }, data: { passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: true } });
  await audit(adminId(req), "RESET_PASSWORD", "Member", id);
  res.json({ ok: true, password: pw });
}));
adminRouter.delete("/members/:id", requireAdmin(["SUPER_ADMIN"]), wrap(async (req, res) => {
  const doomed = await prisma.member.findUnique({ where: { id: pid(req.params.id) }, include: { photos: true } });
  await prisma.member.delete({ where: { id: pid(req.params.id) } });
  if (doomed) await Promise.all([...doomed.photos.map((p) => removeObject(p.url)), removeObject(doomed.biodataFileUrl), removeObject(doomed.idProofUrl)]);
  await audit(adminId(req), "DELETE", "Member", pid(req.params.id));
  res.json({ ok: true });
}));

// ID proof (Aadhaar / green card / visa / passport): sensitive, so every view is
// logged as VIEW_ID_PROOF against the staff login that opened it. Not role-gated -
// the team all work the same queue - and the activity log is what makes that safe.
adminRouter.get("/members/:id/id-proof", wrap(async (req, res) => {
  const m = await prisma.member.findUnique({ where: { id: pid(req.params.id) } });
  if (!m?.idProofUrl) throw new HttpError(404, "No ID proof uploaded.");
  await audit(adminId(req), "VIEW_ID_PROOF", "Member", m.id, { type: m.idProofType });
  res.json({ url: await resolveUrl(m.idProofUrl, 300), type: m.idProofType });
}));

// ---------- "Suggested by Sathsangath" (the team hand-picks a bride or groom for a member) ----------
adminRouter.get("/suggestions", wrap(async (req, res) => {
  const who = { select: { id: true, profileCode: true, fullName: true, gender: true, city: true } };
  const pg = paging(req, 20, { allowedSorts: ["createdAt"] });
  const [total, rows] = await Promise.all([
    prisma.suggestion.count(),
    prisma.suggestion.findMany({ orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take, include: { viewer: who, profile: who } }),
  ]);
  res.json(pg.envelope(total, rows));
}));
adminRouter.post("/suggestions", wrap(async (req, res) => {
  const d = z.object({ viewerId: z.string().min(1), profile: z.string().trim().min(1, "Enter the profile ID, for example SS-1004"), note: z.string().trim().max(300).optional() }).parse(req.body);
  const viewer = await prisma.member.findUnique({ where: { id: d.viewerId } });
  const profile = await prisma.member.findFirst({ where: { OR: [{ id: d.profile }, { profileCode: { equals: d.profile, mode: "insensitive" } }] } });
  if (!viewer || viewer.status !== "APPROVED") throw new HttpError(422, "The member who receives the suggestion must be an approved member.");
  if (!profile) throw new HttpError(422, `No profile found with ID "${d.profile}".`, { fields: { profile: "No profile found with this ID" } });
  if (profile.status !== "APPROVED") throw new HttpError(422, "Only approved profiles can be suggested.", { fields: { profile: "This profile is not approved yet" } });
  if (profile.id === viewer.id) throw new HttpError(422, "Choose a different member.", { fields: { profile: "A member cannot be suggested to themselves" } });
  if (profile.gender === viewer.gender) throw new HttpError(422, `${viewer.gender === "MALE" ? "Grooms" : "Brides"} can only be suggested ${viewer.gender === "MALE" ? "brides" : "grooms"}.`, { fields: { profile: "Choose a profile of the opposite gender" } });
  const existing = await prisma.suggestion.findUnique({ where: { viewerId_profileId: { viewerId: viewer.id, profileId: profile.id } } });
  const sug = await prisma.suggestion.upsert({
    where: { viewerId_profileId: { viewerId: viewer.id, profileId: profile.id } },
    create: { viewerId: viewer.id, profileId: profile.id, note: d.note, adminId: adminId(req) }, update: { note: d.note },
  });
  let delivery;
  if (!existing) {
    await prisma.notification.create({ data: { audience: "MEMBER", memberId: viewer.id, type: "SUGGESTION", title: "Suggested by Sathsangath",
      body: `Our team has suggested a profile for you: ${profile.profileCode}. Have a look.`, data: JSON.stringify({ memberId: profile.id }) } });
    delivery = await sendSuggestion(viewer, profile, d.note);
  }
  await audit(adminId(req), "SUGGEST_PROFILE", "Member", viewer.id, { profile: profile.profileCode, note: d.note });
  res.status(existing ? 200 : 201).json({ id: sug.id, delivery });
}));
adminRouter.delete("/suggestions/:id", wrap(async (req, res) => {
  const s = await prisma.suggestion.delete({ where: { id: pid(req.params.id) } });
  await audit(adminId(req), "REMOVE_SUGGESTION", "Member", s.viewerId);
  res.json({ ok: true });
}));
adminRouter.patch("/suggestions/:id", wrap(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().max(300).optional().or(z.literal("").transform(() => undefined)) }).parse(req.body);
  const s = await prisma.suggestion.update({ where: { id: pid(req.params.id) }, data: { note: note ?? null } });
  res.json({ ok: true, id: s.id, note: s.note });
}));

adminRouter.get("/members/:id/document", wrap(async (req, res) => {
  const m = await prisma.member.findUnique({ where: { id: pid(req.params.id) } });
  if (!m?.biodataFileUrl) throw new HttpError(404, "No document uploaded.");
  res.json({ url: await resolveUrl(m.biodataFileUrl, 300) });
}));

// ---------- Membership ----------
const membershipSchema = z.object({
  plan:      z.enum(["DIKRI", "DIKRA", "SIGNATURE"]),
  startDate: z.string().datetime(),
  endDate:   z.string().datetime().optional(), // optional
  note:      z.string().trim().max(300).optional(),
});

/**
 * Everything our team has done to this member, newest first — the audit trail
 * for one profile.
 *
 * Admin actions are recorded against entity "Member" with the member's id, so
 * this is that slice of the audit log. `detail` is handed over as the stored
 * JSON string; the caller decides what of it is worth showing.
 */
/**
 * What the member did to their own profile that a reviewer needs to see.
 *
 * Deliberately not everything they do: logins and likes would bury the few
 * entries that matter when deciding whether a correction was answered.
 */
const MEMBER_ACTIONS_WORTH_SHOWING = [
  "SUBMITTED_BIODATA", "RESUBMITTED", "UPDATED_PROFILE",
  "UPDATED_CONTACT_DETAILS", "UPLOADED_PHOTOS", "DELETED_PHOTO", "CHANGED_MAIN_PHOTO",
];

adminRouter.get("/members/:id/history", wrap(async (req, res) => {
  const id = pid(req.params.id);
  const rows = await prisma.auditLog.findMany({
    where: {
      OR: [
        // Admin actions are recorded against the member as the entity...
        { entity: "Member", entityId: id, actorType: "ADMIN" },
        // ...the member's own against memberId, whatever entity they touched.
        { memberId: id, actorType: "MEMBER", action: { in: MEMBER_ACTIONS_WORTH_SHOWING } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { admin: { select: { name: true } } },
  });
  res.json(rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorType: r.actorType,
    admin: r.admin?.name ?? r.actorName ?? (r.actorType === "MEMBER" ? "The member" : "System"),
    detail: r.detail,
    createdAt: r.createdAt,
  })));
}));

adminRouter.get("/members/:id/membership", wrap(async (req, res) => {
  const rows = await prisma.membershipPlan.findMany({
    where: { memberId: pid(req.params.id) },
    orderBy: { startDate: "desc" },
  });
  res.json(rows);
}));

adminRouter.post("/members/:id/membership", wrap(async (req, res) => {
  const d = membershipSchema.parse(req.body);
  const memberId = pid(req.params.id);
  const m = await prisma.member.findUnique({ where: { id: memberId } });
  if (!m) throw new HttpError(404, "Member not found.");
  const start = new Date(d.startDate);
  const end   = d.endDate ? new Date(d.endDate) : null;
  if (end && end <= start) throw new HttpError(422, "End date must be after start date.");
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId(req) }, select: { name: true } });
  const row = await prisma.membershipPlan.create({
    data: { memberId, plan: d.plan, startDate: start, endDate: end, note: d.note, createdBy: admin?.name },
  });
  await audit(adminId(req), "ASSIGN_MEMBERSHIP", "Member", memberId, { plan: d.plan, startDate: d.startDate, endDate: d.endDate });
  res.status(201).json(row);
}));

adminRouter.delete("/members/:id/membership/:planId", wrap(async (req, res) => {
  const row = await prisma.membershipPlan.findUnique({ where: { id: pid(req.params.planId) } });
  if (!row || row.memberId !== pid(req.params.id)) throw new HttpError(404, "Membership plan not found.");
  await prisma.membershipPlan.delete({ where: { id: row.id } });
  await audit(adminId(req), "REMOVE_MEMBERSHIP", "Member", pid(req.params.id), { planId: row.id });
  res.json({ ok: true });
}));

// ---------- Tags ----------
adminRouter.get("/tags", wrap(async (_req, res) => {
  res.json(await prisma.tagCategory.findMany({ include: { values: { orderBy: { value: "asc" } } }, orderBy: { name: "asc" } }));
}));
adminRouter.post("/tags/categories", wrap(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(2, "Enter a category name") }).parse(req.body);
  res.status(201).json(await prisma.tagCategory.create({ data: { name } }));
}));
adminRouter.delete("/tags/categories/:id", wrap(async (req, res) => { await prisma.tagCategory.delete({ where: { id: pid(req.params.id) } }); res.json({ ok: true }); }));
adminRouter.post("/tags/values", wrap(async (req, res) => {
  const d = z.object({ categoryId: z.string(), value: z.string().trim().min(1, "Enter a value") }).parse(req.body);
  res.status(201).json(await prisma.tagValue.upsert({ where: { categoryId_value: d }, create: d, update: {} }));
}));
adminRouter.delete("/tags/values/:id", wrap(async (req, res) => { await prisma.tagValue.delete({ where: { id: pid(req.params.id) } }); res.json({ ok: true }); }));

adminRouter.put("/members/:id/tags", wrap(async (req, res) => {
  const { tagIds } = z.object({ tagIds: z.array(z.string()) }).parse(req.body);
  const id = pid(req.params.id);
  await prisma.$transaction([prisma.memberTag.deleteMany({ where: { memberId: id } }), ...tagIds.map((t) => prisma.memberTag.create({ data: { memberId: id, tagValueId: t } }))]);
  await audit(adminId(req), "TAG", "Member", id, { tagIds });
  res.json({ ok: true });
}));

// ---------- Visibility overrides ----------
adminRouter.put("/overrides", wrap(async (req, res) => {
  const d = z.object({ viewerId: z.string(), profileId: z.string(), action: z.enum(["SHOW", "HIDE"]) }).parse(req.body);
  if (d.viewerId === d.profileId) throw new HttpError(422, "Choose two different members.");
  await prisma.visibilityOverride.upsert({ where: { viewerId_profileId: { viewerId: d.viewerId, profileId: d.profileId } }, create: d, update: { action: d.action } });
  await audit(adminId(req), `OVERRIDE_${d.action}`, "Member", d.viewerId, d);
  res.json({ ok: true });
}));
adminRouter.delete("/overrides/:id", wrap(async (req, res) => { await prisma.visibilityOverride.delete({ where: { id: pid(req.params.id) } }); res.json({ ok: true }); }));

// ---------- Likes & introduction requests ----------
/** Pairs (as "a:b") among these members whose contact sharing is approved. Returns none if the table is missing, so lists still load before the database has been updated. */
async function sharedPairs(ids: string[]) {
  try {
    const rows = await prisma.contactShare.findMany({ where: { memberAId: { in: ids }, memberBId: { in: ids } }, select: { memberAId: true, memberBId: true } });
    return new Set(rows.map((s) => `${s.memberAId}:${s.memberBId}`));
  } catch (e) {
    console.error("contactShare lookup failed (run `prisma db push`?):", (e as Error).message);
    return new Set<string>();
  }
}

/** The membership plan each member is on today (key), so lists can show who holds which package. */
async function planMap(memberIds: string[]) {
  const now = new Date();
  const rows = await prisma.membershipPlan.findMany({
    where: { memberId: { in: memberIds }, startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] },
    orderBy: { startDate: "desc" }, select: { memberId: true, plan: true },
  });
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(r.memberId)) m.set(r.memberId, r.plan);
  return m;
}

/** Stored photo keys are not browser URLs: swap each listed member's photoUrl for a signed link, and add their current plan. */
async function withPhotos<T extends Record<string, any>>(rows: T[], keys: string[]): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const ids = rows.flatMap((r) => keys.map((k) => r[k]?.id as string | undefined)).filter((x): x is string => !!x);
  const plans = await planMap([...new Set(ids)]);
  return Promise.all(rows.map(async (r) => {
    const out: Record<string, any> = { ...r }; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const k of keys) if (out[k]) out[k] = { ...out[k], photoUrl: await resolveUrl(out[k].photoUrl), plan: plans.get(out[k].id) ?? null };
    return out as T;
  }));
}
adminRouter.get("/likes", wrap(async (req, res) => {
  const pg = paging(req, 20, { allowedSorts: ["createdAt"] });
  const [total, rows] = await Promise.all([
    prisma.like.count(),
    prisma.like.findMany({ orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take, include: { liker: { select: { id: true, profileCode: true, fullName: true, phone: true, photoUrl: true, gender: true } }, liked: { select: { id: true, profileCode: true, fullName: true, phone: true, photoUrl: true, gender: true } } } }),
  ]);
  res.json(pg.envelope(total, await withPhotos(rows, ["liker", "liked"])));
}));
adminRouter.get("/introductions", wrap(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const pg = paging(req, 20, { allowedSorts: ["createdAt", "status"] });
  const where = status ? { status } : {};
  const [total, rows] = await Promise.all([
    prisma.introRequest.count({ where }),
    prisma.introRequest.findMany({
      where, orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take,
      include: { requester: { select: { id: true, profileCode: true, fullName: true, phone: true, email: true, photoUrl: true, gender: true } }, target: { select: { id: true, profileCode: true, fullName: true, phone: true, email: true, photoUrl: true, gender: true } } },
    }),
  ]);
  const newCount = await prisma.introRequest.count({ where: { status: "NEW" } });
  const shared = await sharedPairs(rows.flatMap((r) => [r.requesterId, r.targetId]));
  const items = (await withPhotos(rows, ["requester", "target"])).map((r) => {
    const k = pair(r.requesterId, r.targetId);
    return { ...r, contactShared: shared.has(`${k.memberAId}:${k.memberBId}`) };
  });
  res.json({ ...pg.envelope(total, items), newCount });
}));
adminRouter.patch("/introductions/:id", wrap(async (req, res) => {
  const d = z.object({ status: z.enum(["NEW", "UNDER_REVIEW", "INTRODUCTION_FACILITATED", "CLOSED"]), adminNote: z.string().trim().optional() }).parse(req.body);
  const r = await prisma.introRequest.update({ where: { id: pid(req.params.id) }, data: d });
  await audit(adminId(req), "INTRO_STATUS", "IntroRequest", r.id, d);
  res.json(r);
}));

// ---------- Messages, blog, content, audit ----------
adminRouter.get("/messages", wrap(async (req, res) => {
  const pg = paging(req, 20, { allowedSorts: ["createdAt", "name", "handled"] });
  const [total, rows] = await Promise.all([prisma.contactMessage.count(), prisma.contactMessage.findMany({ orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take })]);
  res.json(pg.envelope(total, rows));
}));
adminRouter.patch("/messages/:id", wrap(async (req, res) => { res.json(await prisma.contactMessage.update({ where: { id: pid(req.params.id) }, data: { handled: !!req.body.handled } })); }));

// ---------- Announcements (members see these in their panel) ----------
const announcementSchema = z.object({ title: z.string().trim().min(3, "Enter a title"), body: z.string().trim().min(5, "Write the announcement"), active: z.boolean().default(true) });
adminRouter.get("/announcements", wrap(async (req, res) => {
  const pg = paging(req, 20, { allowedSorts: ["createdAt", "title", "active"] });
  const [total, rows] = await Promise.all([prisma.announcement.count(), prisma.announcement.findMany({ orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take })]);
  res.json(pg.envelope(total, rows));
}));
adminRouter.post("/announcements", wrap(async (req, res) => {
  const d = announcementSchema.parse(req.body);
  const a = await prisma.announcement.create({ data: d });
  if (d.active) {
    const members = await prisma.member.findMany({ where: { status: "APPROVED" }, select: { id: true } });
    await prisma.notification.createMany({ data: members.map((m) => ({ audience: "MEMBER", memberId: m.id, type: "ANNOUNCEMENT", title: d.title, body: d.body.slice(0, 160) })) });
  }
  await audit(adminId(req), "CREATE", "Announcement", a.id, { title: d.title });
  res.status(201).json(a);
}));
adminRouter.put("/announcements/:id", wrap(async (req, res) => {
  const a = await prisma.announcement.update({ where: { id: pid(req.params.id) }, data: announcementSchema.parse(req.body) });
  await audit(adminId(req), "EDIT", "Announcement", a.id, { title: a.title });
  res.json(a);
}));
adminRouter.delete("/announcements/:id", wrap(async (req, res) => {
  await prisma.announcement.delete({ where: { id: pid(req.params.id) } });
  await audit(adminId(req), "DELETE", "Announcement", pid(req.params.id));
  res.json({ ok: true });
}));

// ---------- Admin notifications (mutual likes) ----------
adminRouter.get("/notifications", wrap(async (req, res) => {
  const pg = paging(req, 20, { allowedSorts: ["createdAt", "read"] });
  const [total, rows] = await Promise.all([
    prisma.notification.count({ where: { audience: "ADMIN" } }),
    prisma.notification.findMany({ where: { audience: "ADMIN" }, orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take }),
  ]);
  const ids = [...new Set(rows.flatMap((n) => { try { const d = JSON.parse(n.data ?? "{}"); return [d.a, d.b]; } catch { return []; } }).filter(Boolean))] as string[];
  const people = await prisma.member.findMany({ where: { id: { in: ids } }, select: { id: true, profileCode: true, fullName: true, phone: true, photoUrl: true, gender: true } });
  const byId = new Map(await Promise.all(people.map(async (p) => [p.id, { ...p, photoUrl: await resolveUrl(p.photoUrl) }] as const)));
  const plans = await planMap(ids);
  const shared = await sharedPairs(ids);
  res.json(pg.envelope(total, rows.map((n) => {
    let d: { a?: string; b?: string } = {}; try { d = JSON.parse(n.data ?? "{}"); } catch {}
    const k = d.a && d.b ? pair(d.a, d.b) : null;
    const pa = byId.get(d.a ?? ""), pb = byId.get(d.b ?? "");
    return { ...n, a: pa ? { ...pa, plan: plans.get(pa.id) ?? null } : null, b: pb ? { ...pb, plan: plans.get(pb.id) ?? null } : null, contactShared: !!k && shared.has(`${k.memberAId}:${k.memberBId}`) };
  })));
}));
// Two members who liked each other see each other's profile, but not the mobile number or email, until our team approves it here.
const sharePair = z.object({ a: z.string().min(1), b: z.string().min(1) });
adminRouter.post("/mutual/share-contact", wrap(async (req, res) => {
  const { a, b } = sharePair.parse(req.body);
  if (a === b) throw new HttpError(422, "Choose two different members.");
  if (!(await areMutual(a, b))) throw new HttpError(422, "These two members have not liked each other.");
  const [ma, mb] = await Promise.all([prisma.member.findUniqueOrThrow({ where: { id: a } }), prisma.member.findUniqueOrThrow({ where: { id: b } })]);
  const k = pair(a, b);
  await prisma.contactShare.upsert({ where: { memberAId_memberBId: k }, create: { ...k, approvedBy: adminId(req) }, update: {} });
  const first = (n: string) => n.split(" ")[0];
  await prisma.notification.createMany({ data: [
    { audience: "MEMBER", memberId: ma.id, type: "CONTACT_SHARED", title: "Contact details shared", body: `Sathsangath has approved sharing contact details with ${first(mb.fullName)} (${mb.profileCode}). Open their profile to see them.`, data: JSON.stringify({ memberId: mb.id }) },
    { audience: "MEMBER", memberId: mb.id, type: "CONTACT_SHARED", title: "Contact details shared", body: `Sathsangath has approved sharing contact details with ${first(ma.fullName)} (${ma.profileCode}). Open their profile to see them.`, data: JSON.stringify({ memberId: ma.id }) },
  ] });
  await Promise.all([
    sendPush(ma.fcmToken, "Contact details shared", `You can now see ${first(mb.fullName)}'s contact details.`, { type: "CONTACT_SHARED", memberId: mb.id }),
    sendPush(mb.fcmToken, "Contact details shared", `You can now see ${first(ma.fullName)}'s contact details.`, { type: "CONTACT_SHARED", memberId: ma.id }),
  ]);
  await audit(adminId(req), "APPROVE_CONTACT_SHARE", "Member", a, { with: b });
  res.json({ ok: true });
}));
adminRouter.post("/mutual/unshare-contact", wrap(async (req, res) => {
  const { a, b } = sharePair.parse(req.body);
  await prisma.contactShare.deleteMany({ where: pair(a, b) });
  await audit(adminId(req), "REVOKE_CONTACT_SHARE", "Member", a, { with: b });
  res.json({ ok: true });
}));
adminRouter.post("/notifications/read-all", wrap(async (_req, res) => { await prisma.notification.updateMany({ where: { audience: "ADMIN", read: false }, data: { read: true } }); res.json({ ok: true }); }));
adminRouter.patch("/notifications/:id", wrap(async (req, res) => { await prisma.notification.update({ where: { id: pid(req.params.id) }, data: { read: true } }); res.json({ ok: true }); }));

adminRouter.get("/audit", wrap(async (req, res) => {
  const t = typeof req.query.actor === "string" ? req.query.actor : "";
  // ?staff=<adminUserId> narrows the log to one admin-portal login. It implies the
  // ADMIN actor type, so it overrides any ?actor rather than fighting with it.
  const staff = typeof req.query.staff === "string" && req.query.staff ? req.query.staff : "";
  const pg = paging(req, 20, { allowedSorts: ["createdAt", "actorType", "action"] });
  const where: Prisma.AuditLogWhereInput = staff ? { adminId: staff } : t ? { actorType: t } : {};
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take, include: { admin: { select: { name: true } } } }),
  ]);
  res.json(pg.envelope(total, rows.map((l) => ({ id: l.id, actorType: l.actorType, actor: l.admin?.name ?? l.actorName ?? (l.actorType === "PUBLIC" ? "Website visitor" : "System"), adminId: l.adminId, action: l.action, entity: l.entity, entityId: l.entityId, detail: l.detail, createdAt: l.createdAt }))));
}));

// ---------- Staff ----------
// Every admin-portal login is one AdminUser row, so the activity log can name the
// person behind each action. There is no RBAC: staff can do everything the owner
// can EXCEPT manage these logins, which is why only this block is owner-gated.
const requireOwner = requireAdmin([OWNER_ROLE]);
const staffShape = { id: true, name: true, email: true, role: true, active: true, mustChangePassword: true, createdAt: true } as const;
const staffOut = (a: { role: string } & Record<string, unknown>) => ({ ...a, role: normaliseRole(a.role) });
const staffPassword = z.string().min(8, "Use at least 8 characters").regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number");

/** Names for the activity log's "who" filter. Any admin may read this: it is the
 *  staff list without emails or status, and the log already prints these names. */
adminRouter.get("/staff/names", wrap(async (_req, res) => {
  res.json(await prisma.adminUser.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }));
}));

adminRouter.get("/staff", requireOwner, wrap(async (req, res) => {
  const rows = await prisma.adminUser.findMany({ orderBy: [{ active: "desc" }, { createdAt: "asc" }], select: staffShape });
  res.json({ me: adminId(req), items: rows.map(staffOut) });
}));

/**
 * Creates a login with a temporary password and returns it in plaintext ONCE, the
 * same way an admin issues a member's password: nothing is emailed, the owner shares
 * it however they like, and mustChangePassword forces the staff member to replace it
 * at first login so the owner does not keep knowing it.
 */
adminRouter.post("/staff", requireOwner, wrap(async (req, res) => {
  const d = z.object({
    name: z.string().trim().min(2, "Enter the person's name"),
    email: z.string().trim().email("Enter a valid email"),
    password: staffPassword.optional(),
  }).parse(req.body);
  const email = d.email.toLowerCase();
  if (await prisma.adminUser.findUnique({ where: { email } })) {
    throw new HttpError(409, "An admin login with this email already exists.", { fields: { email: "Already in use" } });
  }
  const pw = d.password ?? tempPassword();
  // New logins are always staff. The owner role is not handed out from the portal.
  const a = await prisma.adminUser.create({ data: { name: d.name, email, role: "STAFF", passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: true } });
  await audit(adminId(req), "CREATE_STAFF", "AdminUser", a.id, { name: a.name });
  res.status(201).json({ id: a.id, password: pw });
}));

async function staffById(id: unknown) {
  const a = await prisma.adminUser.findUnique({ where: { id: pid(id) }, select: staffShape });
  if (!a) throw new HttpError(404, "Admin login not found.");
  return a;
}

adminRouter.patch("/staff/:id", requireOwner, wrap(async (req, res) => {
  const d = z.object({
    name: z.string().trim().min(2, "Enter the person's name").optional(),
    email: z.string().trim().email("Enter a valid email").optional(),
    active: z.boolean().optional(),
  }).parse(req.body);
  const a = await staffById(req.params.id);
  // The owner's own row is never deactivated, and nobody deactivates themselves:
  // either would leave the portal with nobody able to manage its logins.
  if (d.active === false) {
    if (a.id === adminId(req)) throw new HttpError(422, "You cannot deactivate your own login.");
    if (isOwner(a.role)) throw new HttpError(422, "The owner's login cannot be deactivated.");
  }
  const email = d.email?.toLowerCase();
  if (email && email !== a.email) {
    const clash = await prisma.adminUser.findUnique({ where: { email } });
    if (clash) throw new HttpError(409, "An admin login with this email already exists.", { fields: { email: "Already in use" } });
  }
  const updated = await prisma.adminUser.update({ where: { id: a.id }, data: { ...(d.name && { name: d.name }), ...(email && { email }), ...(d.active !== undefined && { active: d.active }) }, select: staffShape });
  // Turning a login on or off is the entry an owner will look for later, so it is
  // logged as its own action rather than as a generic edit.
  const action = d.active === undefined ? "EDIT_STAFF" : d.active ? "REACTIVATE_STAFF" : "DEACTIVATE_STAFF";
  await audit(adminId(req), action, "AdminUser", a.id, { name: updated.name });
  res.json(staffOut(updated));
}));

/** A locked-out staff member gets a fresh temporary password, shown once. */
adminRouter.post("/staff/:id/reset-password", requireOwner, wrap(async (req, res) => {
  const a = await staffById(req.params.id);
  const pw = tempPassword();
  await prisma.adminUser.update({ where: { id: a.id }, data: { passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: true } });
  await audit(adminId(req), "RESET_STAFF_PASSWORD", "AdminUser", a.id, { name: a.name });
  res.json({ ok: true, password: pw });
}));
