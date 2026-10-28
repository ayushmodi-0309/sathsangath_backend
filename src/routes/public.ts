import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/db";
import { learnTagValuesFor } from "../lib/tags";
import { HttpError, wrap } from "../lib/http";
import { config } from "../lib/config";
import { activity, memberLabel, nextProfileCode, normPhone } from "../lib/util";
import { rateLimit } from "express-rate-limit";
import { removeObject, saveUpload } from "../lib/storage";
import { checkPhone, isCountry, type CountryCode } from "../lib/phone";
import { searchCities, verifyCity } from "../lib/cities";
import { sendSubmissionReceived } from "../lib/notify";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
// Files are buffered in memory and handed to the storage provider (see lib/storage); nothing touches local disk.
const storage = multer.memoryStorage();
export const upload = multer({
  storage, limits: { fileSize: 8 * 1024 * 1024, files: 3 },
  fileFilter: (_r, f, cb) => (ALLOWED.has(f.mimetype) ? cb(null, true) : cb(new HttpError(422, "Only JPG, PNG, WebP or PDF files are allowed."))),
});
/** Member photo gallery uploads: images only, up to 6 files of 6 MB. */
export const photoUpload = multer({
  storage, limits: { fileSize: 6 * 1024 * 1024, files: 6 },
  fileFilter: (_r, f, cb) => (f.mimetype.startsWith("image/") && ALLOWED.has(f.mimetype) ? cb(null, true) : cb(new HttpError(422, "Photos must be JPG, PNG or WebP."))),
});

const arr = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) return v.startsWith("[") ? JSON.parse(v) : v.split(",");
  return [];
}, z.array(z.string().trim()));
const opt = z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined));
const num = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().optional());
const bool = z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());

export const ID_PROOF_TYPES = ["AADHAAR", "GREEN_CARD", "VISA", "PASSPORT", "OTHER"] as const;
const countryBase = z.string().trim().toUpperCase().refine(isCountry, "Choose a supported country");
// Residence country accepts any non-empty string so members from unlisted countries can still submit.
const countryField = z.string().trim().min(1).max(100).default("IN");
const optPhoneRaw = z.string().trim().optional().or(z.literal("").transform(() => undefined));
/**
 * Birth time is stored as "HH:MM" on a 24-hour clock. The web forms send exactly that, but the
 * Google-Form webhook and bulk imports carry whatever people wrote by hand ("8:36 AM", "04:55
 * A.M.", "8.36 pm"), so those are normalised here rather than rejecting a whole bio data over it.
 */
export function normaliseBirthTime(raw: string): string | null {
  const m = /^(\d{1,2})\s*[:.]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const suffix = m[3]?.toLowerCase().replace(/[.\s]/g, "");
  if (min > 59) return null;
  if (suffix) {
    if (h < 1 || h > 12) return null;
    if (suffix === "am") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
export const birthTimeField = z.string().trim()
  .transform((v, ctx) => {
    const t = normaliseBirthTime(v);
    if (!t) { ctx.addIssue({ code: "custom", message: "Enter the birth time as HH:MM, for example 08:36 or 8:36 PM" }); return z.NEVER; }
    return t;
  })
  .optional().or(z.literal("").transform(() => undefined));
export const weightKgField = z.preprocess(
  (v) => (v === "" || v == null ? undefined : Number(v)),
  z.number("Enter the weight in kilograms").int("Enter the weight in whole kilograms").min(30, "Enter a weight of 30 kg or more").max(250, "Enter a weight of 250 kg or less").optional(),
);

const intakeBase = z.object({
  /** Sathsangath only accepts Hindu families. The website asks this first; the API enforces it too. */
  religion: z.string().trim().default("Hindu").refine((v) => v.toLowerCase() === "hindu", "Sathsangath currently accepts bio data from Hindu families only."),
  fullName: z.string().trim().min(2, "Enter the full name").max(100),
  gender: z.string().transform((s) => s.toUpperCase()).pipe(z.enum(["MALE", "FEMALE"], { message: "Select gender" })),
  dob: z.string().refine((s) => {
    const d = new Date(s); const age = (Date.now() - d.getTime()) / 31557600000;
    return !isNaN(d.getTime()) && age >= 18 && age <= 80;
  }, "Enter a valid date of birth (18 years or older)").optional().or(z.literal("").transform(() => undefined)),
  country: countryField,                 // country they live in (decides which cities are valid)
  phoneCountry: countryBase.optional(), // country of the mobile number; defaults to the residence country
  phone: z.string().trim().min(1, "Enter a mobile number"),
  familyPhoneCountry: countryBase.optional(),
  familyPhone: optPhoneRaw,
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => undefined)),
  familyEmail: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => undefined)),
  idProofType: z.string().trim().toUpperCase().pipe(z.enum(ID_PROOF_TYPES, { message: "Choose the type of ID proof" })).optional().or(z.literal("").transform(() => undefined)),
  heightCm: num,
  weightKg: weightKgField,
  birthTime: birthTimeField, birthPlace: opt,
  maritalStatus: opt, community: opt, subCommunity: opt, city: opt, state: opt, nativePlace: opt,
  education: opt, profession: opt, income: opt, diet: opt,
  fatherOccupation: opt, motherOccupation: opt, siblings: opt, familyBackground: opt, about: opt,
  prefCommunities: arr.optional(), prefCities: arr.optional(),
  prefEducation: arr.optional(), prefOccupation: arr.optional(), prefCountries: arr.optional(),
  prefAgeMin: num, prefAgeMax: num, prefIncomeMin: opt, prefNotes: opt,
  motherTongue: opt, fatherName: opt, motherName: opt, familyType: opt, createdBy: opt,
  prefHeightMinCm: num, prefMaritalStatus: opt, prefRelocate: opt,
  consent: bool.refine((v) => v, "Consent is required to submit your bio data"),
});

/** Cross-field rules: the mobile numbers must be valid for their country and the city must exist in the chosen country. */
export const intakeSchema = intakeBase.transform((v, ctx) => {
  const country = v.country as CountryCode;
  const out = { ...v, country, phone: v.phone, familyPhone: v.familyPhone as string | undefined };
  const p = checkPhone(v.phone, (v.phoneCountry ?? country) as CountryCode);
  if (!p.ok) ctx.addIssue({ code: "custom", path: ["phone"], message: p.error }); else out.phone = p.value;
  if (v.familyPhone) {
    const f = checkPhone(v.familyPhone, (v.familyPhoneCountry ?? v.phoneCountry ?? country) as CountryCode);
    if (!f.ok) ctx.addIssue({ code: "custom", path: ["familyPhone"], message: f.error }); else out.familyPhone = f.value;
  }
  if (v.city) {
    const hit = verifyCity(country, v.city, v.state);
    if (!hit) ctx.addIssue({ code: "custom", path: ["city"], message: `We could not find "${v.city}" in ${country === "IN" ? "India" : country}. Please pick your city from the suggestions.` });
    else { out.city = hit.name; out.state = hit.state || v.state; }
  }
  const { phoneCountry, familyPhoneCountry, ...rest } = out;
  void phoneCountry; void familyPhoneCountry;
  return { ...rest, religion: "Hindu" };
});

/** Shared by the website form, the Google-Form webhook and admin manual entry. */
export async function createSubmission(input: z.infer<typeof intakeSchema>, source: string, files?: { photoUrl?: string; photoUrls?: string[]; biodataFileUrl?: string; idProofUrl?: string }, accountId?: string, dobIsApproximate?: boolean) {
  const dupe = await prisma.member.findFirst({
    where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] },
    select: { id: true },
  });
  if (dupe) throw new HttpError(409, "A bio data with this mobile number or email already exists. Please contact Sathsangath if you need to update it.");
  const { consent, prefCommunities, prefCities, prefEducation, prefOccupation, prefCountries, dob, ...rest } = input;
  if (!dob) throw new HttpError(422, "Enter a date of birth or age.", { fields: { dob: "Enter a date of birth or age" } });
  const { photoUrls, ...fileFields } = files ?? {};
  const photoList = photoUrls?.length ? photoUrls : fileFields.photoUrl ? [fileFields.photoUrl] : [];
  const created = await prisma.member.create({
    data: {
      ...rest, dob: new Date(dob), dobIsApproximate: dobIsApproximate ?? false, source, consentGiven: consent,
      profileCode: await nextProfileCode(),
      prefCommunities: (prefCommunities ?? []).join(","), prefCities: (prefCities ?? []).join(","),
      prefEducation: (prefEducation ?? []).join(","), prefOccupation: (prefOccupation ?? []).join(","),
      prefCountries: (prefCountries ?? []).join(","),
      ...fileFields, ...(photoList[0] && { photoUrl: photoList[0] }),
      ...(accountId && { accountId, mustChangePassword: false }), // self-signup members never get an admin-issued temp password
      ...(photoList.length && { photos: { create: photoList.map((url, i) => ({ url, isMain: i === 0 })) } }),
    },
  });
  // Any value typed that was not on a dropdown yet joins that list, so it is there for the next person.
  await learnTagValuesFor(created.id, created);
  await activity({ type: "PUBLIC", name: memberLabel(created) }, "SUBMITTED_BIODATA", "Member", created.id, { source });
  if (source !== "ADMIN") await sendSubmissionReceived(created); // "we have received your bio data" (email + SMS); never throws
  return created;
}

export const publicRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please try again later." } });

publicRouter.post("/biodata", limiter, upload.fields([{ name: "photo", maxCount: 1 }, { name: "biodata", maxCount: 1 }, { name: "idproof", maxCount: 1 }]), wrap(async (req, res) => {
  if (!req.body.dob) throw new HttpError(422, "Enter a valid date of birth (18 years or older).", { fields: { dob: "Enter a valid date of birth (18 years or older)" } });
  const input = intakeSchema.parse(req.body);
  const f = req.files as Record<string, Express.Multer.File[]> | undefined;
  if (f?.photo?.[0] && f.photo[0].size > MAX_PHOTO_BYTES) {
    const mb = (f.photo[0].size / 1048576).toFixed(1);
    throw new HttpError(422, `Your photo is ${mb} MB. Photos must be 5 MB or smaller.`, { fields: { photos: `Your photo is ${mb} MB. Photos must be 5 MB or smaller.` } });
  }
  // ID proof (Aadhaar, or green card / visa / passport for non-Indians): private, only the admin team can open it.
  if (config.requireIdProof && !f?.idproof?.[0]) throw new HttpError(422, "Please upload your ID proof.", { fields: { idProof: "Please upload your ID proof (Aadhaar, or green card / visa / passport if you are not an Indian citizen)." } });
  if (f?.idproof?.[0] && !input.idProofType) throw new HttpError(422, "Choose the type of ID proof.", { fields: { idProofType: "Choose the type of ID proof" } });
  const photoUrl = f?.photo?.[0] ? await saveUpload("photos", f.photo[0]) : undefined;
  const biodataFileUrl = f?.biodata?.[0] ? await saveUpload("docs", f.biodata[0]) : undefined;
  const idProofUrl = f?.idproof?.[0] ? await saveUpload("docs", f.idproof[0]) : undefined;
  let m;
  try { m = await createSubmission(input, "WEB", { photoUrl, biodataFileUrl, idProofUrl }); }
  catch (e) { await Promise.all([removeObject(photoUrl), removeObject(biodataFileUrl), removeObject(idProofUrl)]); throw e; } // e.g. duplicate phone: don't orphan files
  res.status(201).json({ ok: true, reference: m.profileCode });
}));

// Google Form / Apps Script -> POST with header x-webhook-secret. Same validation & duplicate rules.
publicRouter.post("/intake-webhook", wrap(async (req, res) => {
  if (!config.webhookSecret || req.headers["x-webhook-secret"] !== config.webhookSecret) throw new HttpError(401, "Invalid webhook secret.");
  const m = await createSubmission(intakeSchema.parse(req.body), "GOOGLE_FORM", { biodataFileUrl: typeof req.body.biodataLink === "string" ? req.body.biodataLink : undefined });
  res.status(201).json({ ok: true, reference: m.profileCode });
}));

// City suggestions for the bio data form (and the mobile apps): ?country=IN&q=ahm
const geoLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please slow down." } });
publicRouter.get("/cities", geoLimiter, wrap(async (req, res) => {
  const { country, q } = z.object({ country: countryField, q: z.string().trim().default("") }).parse(req.query);
  res.json(searchCities(country as CountryCode, q, 10));
}));

publicRouter.get("/tags", wrap(async (_req, res) => {
  const cats = await prisma.tagCategory.findMany({
    include: { values: { orderBy: { value: "asc" } } },
    orderBy: { name: "asc" },
  });
  res.json(cats);
}));

publicRouter.post("/contact", limiter, wrap(async (req, res) => {
  const d = z.object({
    name: z.string().trim().min(2, "Enter your name"),
    phone: z.string().trim().optional(),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
    message: z.string().trim().min(5, "Please write a short message").max(3000),
  }).parse(req.body);
  await prisma.contactMessage.create({ data: d });
  await activity({ type: "PUBLIC", name: d.name }, "SENT_MESSAGE", "ContactMessage");
  res.status(201).json({ ok: true });
}));
