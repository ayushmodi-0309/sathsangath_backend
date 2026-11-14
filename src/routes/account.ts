import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../lib/db";
import { HttpError, wrap } from "../lib/http";
import { requireAccount, signToken } from "../lib/auth";
import { includeTags } from "../lib/matching";
import { toSelf } from "../lib/serializers";
import { z } from "zod";
import { newScopedKey, ownsKey, removeObject, saveUpload, storage } from "../lib/storage";
import { createSubmission, intakeSchema, MAX_PHOTO_BYTES, sentDistrict, upload } from "./public";

/**
 * Direct-to-storage uploads.
 *
 * Request bodies to our functions are capped at 4.5 MB by the platform, which a
 * bio data with photos and a scanned document exceeds. The browser instead asks
 * for a short-lived PUT link, uploads straight to the bucket, and submits only
 * the object keys. Keys are namespaced by account so a submission cannot claim
 * someone else's object.
 */
const SIGN_TTL = 5 * 60;
const MAX_DOC_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const DOC_TYPES = ["application/pdf", ...IMAGE_TYPES] as const;
const EXT: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf",
};

type UploadKind = "photo" | "biodata" | "idproof";
const RULES: Record<UploadKind, { kind: "photos" | "docs"; types: readonly string[]; max: number; label: string }> = {
  photo: { kind: "photos", types: IMAGE_TYPES, max: MAX_PHOTO_BYTES, label: "Photos" },
  biodata: { kind: "docs", types: DOC_TYPES, max: MAX_DOC_BYTES, label: "The bio data document" },
  idproof: { kind: "docs", types: DOC_TYPES, max: MAX_DOC_BYTES, label: "The ID proof" },
};
const mb = (n: number) => (n / 1048576).toFixed(1);

/**
 * Confirms an uploaded object really is ours, really is there, and really is
 * within limits.
 *
 * A presigned PUT constrains neither the size nor the content type, so nothing
 * the client uploaded is trusted: the stored object is measured and type-checked
 * here. A mismatched upload is left in the bucket but never reaches a member.
 */
async function claimKey(key: string, kind: UploadKind, accountId: string, field: string) {
  const r = RULES[kind];
  if (!ownsKey(key, r.kind, accountId)) {
    throw new HttpError(422, "That upload is no longer valid. Please attach the file again.", { fields: { [field]: "Please attach the file again." } });
  }
  const meta = await storage.head(key);
  if (!meta) {
    throw new HttpError(422, "That upload did not finish. Please attach the file again.", { fields: { [field]: "Please attach the file again." } });
  }
  if (meta.size > r.max) {
    const msg = `${r.label} must be ${mb(r.max)} MB or smaller.`;
    throw new HttpError(422, msg, { fields: { [field]: msg } });
  }
  if (meta.contentType && !r.types.includes(meta.contentType)) {
    const msg = kind === "photo" ? "Photos must be JPG, PNG or WebP." : `${r.label} must be a PDF, JPG or PNG.`;
    throw new HttpError(422, msg, { fields: { [field]: msg } });
  }
  return key;
}

export const accountRouter = Router();
accountRouter.use(requireAccount);
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please try again later." } });

accountRouter.get("/me", wrap(async (req, res) => {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: req.accountId! } });
  const m = await prisma.member.findUnique({ where: { accountId: account.id }, include: includeTags });
  res.json({ email: account.email, member: m ? await toSelf(m) : null });
}));

// Hand out a short-lived PUT link so the browser can upload a file straight to
// storage. Only reachable by a signed-in, email-verified account.
accountRouter.post("/uploads/sign", limiter, wrap(async (req, res) => {
  const { kind, contentType, size } = z.object({
    kind: z.enum(["photo", "biodata", "idproof"]),
    contentType: z.string().trim().toLowerCase(),
    size: z.number().int().positive(),
  }).parse(req.body ?? {});

  const r = RULES[kind as UploadKind];
  if (!r.types.includes(contentType)) {
    const msg = kind === "photo" ? "Photos must be JPG, PNG or WebP." : `${r.label} must be a PDF, JPG or PNG.`;
    throw new HttpError(422, msg);
  }
  // Checked again against the stored object on submit; this is the early, cheap no.
  if (size > r.max) throw new HttpError(422, `${r.label} must be ${mb(r.max)} MB or smaller.`);

  const key = newScopedKey(r.kind, req.accountId!, EXT[contentType] ?? "");
  res.json({ key, url: await storage.signedPut(key, contentType, SIGN_TTL), expiresIn: SIGN_TTL });
}));

// Submit bio data as a signed-in, email-verified user. The email is always the account's email.
accountRouter.post("/biodata", limiter, upload.fields([{ name: "photo", maxCount: 3 }, { name: "biodata", maxCount: 1 }, { name: "idproof", maxCount: 1 }]), wrap(async (req, res) => {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: req.accountId! } });
  if (await prisma.member.findUnique({ where: { accountId: account.id }, select: { id: true } })) throw new HttpError(409, "You have already submitted your bio data.");
  if (!req.body.dob) throw new HttpError(422, "Enter a valid date of birth (18 years or older).", { fields: { dob: "Enter a valid date of birth (18 years or older)" } });
  const input = intakeSchema.parse({ ...req.body, email: account.email });

  // Files normally arrive as keys already uploaded straight to storage. Inline
  // multipart is still accepted so an older client keeps working.
  const f = req.files as Record<string, Express.Multer.File[]> | undefined;
  const asList = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : []).map(String).map((x) => x.trim()).filter(Boolean);
  const photoKeys = asList(req.body.photoKeys);
  const biodataKey = typeof req.body.biodataKey === "string" ? req.body.biodataKey.trim() : "";
  const idproofKey = typeof req.body.idproofKey === "string" ? req.body.idproofKey.trim() : "";

  const photos = f?.photo ?? [];
  const big = photos.find((x) => x.size > MAX_PHOTO_BYTES);
  if (big) {
    const msg = `A photo is ${mb(big.size)} MB. Photos must be ${mb(MAX_PHOTO_BYTES)} MB or smaller.`;
    throw new HttpError(422, msg, { fields: { photos: msg } });
  }
  if (photos.some((x) => !x.mimetype.startsWith("image/"))) throw new HttpError(422, "Photos must be JPG, PNG or WebP.", { fields: { photos: "Photos must be JPG, PNG or WebP." } });
  if ((idproofKey || f?.idproof?.[0]) && !input.idProofType) throw new HttpError(422, "Choose the type of ID proof.", { fields: { idProofType: "Choose the type of ID proof" } });

  if (photoKeys.length > 3) throw new HttpError(422, "You can add up to 3 photos.", { fields: { photos: "You can add up to 3 photos." } });
  const photoUrls = [
    ...(await Promise.all(photoKeys.map((k) => claimKey(k, "photo", account.id, "photos")))),
    ...(await Promise.all(photos.map((x) => saveUpload("photos", x)))),
  ];
  const biodataFileUrl = biodataKey
    ? await claimKey(biodataKey, "biodata", account.id, "biodata")
    : f?.biodata?.[0] ? await saveUpload("docs", f.biodata[0]) : undefined;
  const idProofUrl = idproofKey
    ? await claimKey(idproofKey, "idproof", account.id, "idProof")
    : f?.idproof?.[0] ? await saveUpload("docs", f.idproof[0]) : undefined;

  let m;
  try { m = await createSubmission(input, "WEB", { photoUrls, biodataFileUrl, idProofUrl }, account.id, undefined, { requireDistrict: sentDistrict(req) }); }
  catch (e) { await Promise.all([...photoUrls.map((u) => removeObject(u)), removeObject(biodataFileUrl), removeObject(idProofUrl)]); throw e; }
  res.status(201).json({ ok: true, reference: m.profileCode, token: signToken({ kind: "member", id: m.id }) });
}));
