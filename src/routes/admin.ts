import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { HttpError, paging, wrap } from "../lib/http";
import { requireAdmin } from "../lib/auth";
import { includeTags } from "../lib/matching";
import { toAdminMember } from "../lib/serializers";
import { learnTagValuesFor } from "../lib/tags";
import { audit, tempPassword } from "../lib/util";
import { sendApproved, sendCorrection, sendCredentials, sendRejection, sendSuggestion } from "../lib/notify";
import { config } from "../lib/config";
import multer from "multer";
import { createSubmission, intakeSchema, MAX_PHOTO_BYTES, normaliseBirthTime } from "./public";
import { removeObject, resolveUrl, saveUpload } from "../lib/storage";
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
  plan: z.enum(["FREE", "BASIC", "PRO"]).optional(),
  // pagination + sort
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["profileCode","fullName","dob","city","community","status","createdAt","maritalStatus","heightCm","education","profession","state","country","religion","motherTongue","familyType","source"]).default("createdAt"),
  order: z.enum(["asc","desc"]).default("desc"),
});
function buildWhere(q: z.infer<typeof listQuery>): Prisma.MemberWhereInput {
  const w: Prisma.MemberWhereInput = {};
  if (q.status) w.status = q.status;
  if (q.gender) w.gender = q.gender;
  if (q.city) w.city = { contains: q.city, mode: "insensitive" };
  if (q.community) w.community = { contains: q.community, mode: "insensitive" };
  if (q.tag) w.tags = { some: { tagValueId: q.tag } };
  if (q.q) w.OR = [{ fullName: { contains: q.q, mode: "insensitive" } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: "insensitive" } }, { profileCode: { contains: q.q, mode: "insensitive" } }];
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
  if (q.subCommunity) w.subCommunity = { contains: q.subCommunity, mode: "insensitive" };
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
  if (q.plan === "FREE") w.membershipPlans = { none: { endDate: { gte: new Date() } } };
  if (q.plan === "BASIC") w.membershipPlans = { some: { plan: "BASIC", endDate: { gte: new Date() } } };
  if (q.plan === "PRO")   w.membershipPlans = { some: { plan: "PRO",   endDate: { gte: new Date() } } };
  return w;
}
void tri; // suppress unused warning — may be used in future

adminRouter.get("/members", wrap(async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = buildWhere(q);
  const [total, rows] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.findMany({ where, include: includeTags, orderBy: { [q.sort]: q.order } as Record<string, "asc"|"desc">, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({ total, page: q.page, pageSize: q.pageSize, sort: q.sort, order: q.order, items: await Promise.all(rows.map(toAdminMember)) });
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
  res.json({ ...(await toAdminMember(m)), likesGiven, likesReceivedList, likesReceived: likesReceivedList.length, intros, introsReceived, overrides, suggestions: suggestionsWithFlags });
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

const editSchema = z.object({
  fullName: z.string().trim().min(2), phone: z.string().trim(), email: z.string().trim().nullable(),
  familyPhone: z.string().trim().nullable(), familyEmail: z.string().trim().nullable(),
  gender: z.enum(["MALE", "FEMALE"]), heightCm: intEdit(100, 250), maritalStatus: z.string().nullable(),
  weightKg: intEdit(30, 250), birthTime: birthTimeEdit, birthPlace: z.string().nullable(),
  community: z.string().nullable(), subCommunity: z.string().nullable(), city: z.string().nullable(), state: z.string().nullable(),
  education: z.string().nullable(), profession: z.string().nullable(), income: z.string().nullable(), diet: z.string().nullable(),
  fatherOccupation: z.string().nullable(), motherOccupation: z.string().nullable(), siblings: z.string().nullable(),
  familyBackground: z.string().nullable(), about: z.string().nullable(), prefAgeMin: intEdit(18, 80), prefAgeMax: intEdit(18, 80),
  prefNotes: z.string().nullable(), adminNote: z.string().nullable(),
  motherTongue: z.string().nullable(), fatherName: z.string().nullable(), motherName: z.string().nullable(), familyType: z.string().nullable(), createdBy: z.string().nullable(),
  nativePlace: z.string().nullable(), prefHeightMinCm: intEdit(100, 250), prefMaritalStatus: z.string().nullable(), prefRelocate: z.string().nullable(),
  prefCommunities: prefList, prefCities: prefList,
  prefEducation: prefList, prefOccupation: prefList, prefCountries: prefList,
  prefIncomeMin: z.string().nullable(),
}).partial();

adminRouter.patch("/members/:id", wrap(async (req, res) => {
  const { prefCommunities, prefCities, prefEducation, prefOccupation, prefCountries, ...d } = editSchema.parse(req.body);
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
  const { prefCommunities, prefCities, prefEducation, prefOccupation, prefCountries, dob, age: _age, country, phoneCountry, familyPhoneCountry, ...d } = fullEditSchema.parse(body);
  void _age;
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
  let biodataFileUrl: string | undefined, idProofUrl: string | undefined;
  try {
    for (const p of newPhotos) uploadedPhotoUrls.push(await saveUpload("photos", p));
    if (f?.biodata?.[0]) biodataFileUrl = await saveUpload("docs", f.biodata[0]);
    if (f?.idproof?.[0]) idProofUrl = await saveUpload("docs", f.idproof[0]);
    const m = await prisma.member.update({
      where: { id },
      data: {
        ...d,
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
        ...(uploadedPhotoUrls.length && { photoUrl: uploadedPhotoUrls[0] }),
        ...(uploadedPhotoUrls.length && { photos: { create: uploadedPhotoUrls.map((url, i) => ({ url, isMain: i === 0 })) } }),
      },
      include: includeTags,
    });
    await audit(adminId(req), "EDIT", "Member", m.id, { fields: Object.keys(req.body) });
    res.json(await toAdminMember(m));
  } catch (e) {
    await Promise.all([...uploadedPhotoUrls.map((u) => removeObject(u)), removeObject(biodataFileUrl), removeObject(idProofUrl)]);
    throw e;
  }
}));

// ---------- Review workflow ----------
async function issueCredentials(id: string) {
  const pw = tempPassword();
  const m = await prisma.member.update({ where: { id }, data: { passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: true } });
  return sendCredentials(m, pw); // { email, sms }: "sent" | "skipped" | "failed"
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

adminRouter.post("/members/:id/suspend", wrap(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().optional() }).parse(req.body ?? {});
  await prisma.member.update({ where: { id: pid(req.params.id) }, data: { status: "SUSPENDED", adminNote: note } });
  await audit(adminId(req), "SUSPEND", "Member", pid(req.params.id), { note });
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
adminRouter.post("/members/:id/reactivate", wrap(async (req, res) => {
  await prisma.member.update({ where: { id: pid(req.params.id) }, data: { status: "APPROVED", adminNote: null } });
  await audit(adminId(req), "REACTIVATE", "Member", pid(req.params.id));
  res.json({ ok: true });
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

// ID proof (Aadhaar / green card / visa / passport): sensitive, so only SUPER_ADMIN and ADMIN can open it, and every view is logged.
adminRouter.get("/members/:id/id-proof", requireAdmin(["SUPER_ADMIN", "ADMIN"]), wrap(async (req, res) => {
  const m = await prisma.member.findUnique({ where: { id: pid(req.params.id) } });
  if (!m?.idProofUrl) throw new HttpError(404, "No ID proof uploaded.");
  await audit(adminId(req), "VIEW_ID_PROOF", "Member", m.id, { type: m.idProofType });
  res.json({ url: await resolveUrl(m.idProofUrl, 300), type: m.idProofType });
}));

// ---------- "Suggested by Sathsangath" (super admin / admin hand-picks a bride or groom for a member) ----------
adminRouter.get("/suggestions", requireAdmin(["SUPER_ADMIN", "ADMIN"]), wrap(async (req, res) => {
  const who = { select: { id: true, profileCode: true, fullName: true, gender: true, city: true } };
  const pg = paging(req, 20, { allowedSorts: ["createdAt"] });
  const [total, rows] = await Promise.all([
    prisma.suggestion.count(),
    prisma.suggestion.findMany({ orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take, include: { viewer: who, profile: who } }),
  ]);
  res.json(pg.envelope(total, rows));
}));
adminRouter.post("/suggestions", requireAdmin(["SUPER_ADMIN", "ADMIN"]), wrap(async (req, res) => {
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
adminRouter.delete("/suggestions/:id", requireAdmin(["SUPER_ADMIN", "ADMIN"]), wrap(async (req, res) => {
  const s = await prisma.suggestion.delete({ where: { id: pid(req.params.id) } });
  await audit(adminId(req), "REMOVE_SUGGESTION", "Member", s.viewerId);
  res.json({ ok: true });
}));
adminRouter.patch("/suggestions/:id", requireAdmin(["SUPER_ADMIN", "ADMIN"]), wrap(async (req, res) => {
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
  plan:      z.enum(["BASIC", "PRO"]),
  startDate: z.string().datetime(),
  endDate:   z.string().datetime(),
  note:      z.string().trim().max(300).optional(),
});

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
  const end   = new Date(d.endDate);
  if (end <= start) throw new HttpError(422, "End date must be after start date.");
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
adminRouter.get("/likes", wrap(async (req, res) => {
  const pg = paging(req, 20, { allowedSorts: ["createdAt"] });
  const [total, rows] = await Promise.all([
    prisma.like.count(),
    prisma.like.findMany({ orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take, include: { liker: { select: { id: true, profileCode: true, fullName: true, phone: true } }, liked: { select: { id: true, profileCode: true, fullName: true, phone: true } } } }),
  ]);
  res.json(pg.envelope(total, rows));
}));
adminRouter.get("/introductions", wrap(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const pg = paging(req, 20, { allowedSorts: ["createdAt", "status"] });
  const where = status ? { status } : {};
  const [total, rows] = await Promise.all([
    prisma.introRequest.count({ where }),
    prisma.introRequest.findMany({
      where, orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take,
      include: { requester: { select: { id: true, profileCode: true, fullName: true, phone: true, email: true } }, target: { select: { id: true, profileCode: true, fullName: true, phone: true, email: true } } },
    }),
  ]);
  res.json(pg.envelope(total, rows));
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
  res.json(pg.envelope(total, rows.map((n) => { let d: { a?: string; b?: string } = {}; try { d = JSON.parse(n.data ?? "{}"); } catch {} return { ...n, a: byId.get(d.a ?? "") ?? null, b: byId.get(d.b ?? "") ?? null }; })));
}));
adminRouter.post("/notifications/read-all", wrap(async (_req, res) => { await prisma.notification.updateMany({ where: { audience: "ADMIN", read: false }, data: { read: true } }); res.json({ ok: true }); }));
adminRouter.patch("/notifications/:id", wrap(async (req, res) => { await prisma.notification.update({ where: { id: pid(req.params.id) }, data: { read: true } }); res.json({ ok: true }); }));

adminRouter.get("/audit", wrap(async (req, res) => {
  const t = typeof req.query.actor === "string" ? req.query.actor : "";
  const pg = paging(req, 20, { allowedSorts: ["createdAt", "actorType", "action"] });
  const where = t ? { actorType: t } : {};
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { [pg.sort]: pg.order } as Record<string, "asc"|"desc">, skip: pg.skip, take: pg.take, include: { admin: { select: { name: true } } } }),
  ]);
  res.json(pg.envelope(total, rows.map((l) => ({ id: l.id, actorType: l.actorType, actor: l.admin?.name ?? l.actorName ?? (l.actorType === "PUBLIC" ? "Website visitor" : "System"), action: l.action, entity: l.entity, entityId: l.entityId, detail: l.detail, createdAt: l.createdAt }))));
}));

// ---------- Staff ----------
adminRouter.get("/staff", requireAdmin(["SUPER_ADMIN"]), wrap(async (_req, res) => {
  res.json(await prisma.adminUser.findMany({ select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } }));
}));
adminRouter.post("/staff", requireAdmin(["SUPER_ADMIN"]), wrap(async (req, res) => {
  const d = z.object({ name: z.string().trim().min(2), email: z.string().trim().email(), password: z.string().min(8, "Use at least 8 characters"), role: z.enum(["ADMIN", "STAFF"]) }).parse(req.body);
  const a = await prisma.adminUser.create({ data: { name: d.name, email: d.email.toLowerCase(), role: d.role, passwordHash: await bcrypt.hash(d.password, 11) } });
  await audit(adminId(req), "CREATE", "AdminUser", a.id);
  res.status(201).json({ id: a.id });
}));
