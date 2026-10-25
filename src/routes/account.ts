import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../lib/db";
import { HttpError, wrap } from "../lib/http";
import { requireAccount, signToken } from "../lib/auth";
import { includeTags } from "../lib/matching";
import { toSelf } from "../lib/serializers";
import { removeObject, saveUpload } from "../lib/storage";
import { createSubmission, intakeSchema, MAX_PHOTO_BYTES, upload } from "./public";

export const accountRouter = Router();
accountRouter.use(requireAccount);
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please try again later." } });

accountRouter.get("/me", wrap(async (req, res) => {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: req.accountId! } });
  const m = await prisma.member.findUnique({ where: { accountId: account.id }, include: includeTags });
  res.json({ email: account.email, member: m ? await toSelf(m) : null });
}));

// Submit bio data as a signed-in, email-verified user. The email is always the account's email.
accountRouter.post("/biodata", limiter, upload.fields([{ name: "photo", maxCount: 3 }, { name: "biodata", maxCount: 1 }]), wrap(async (req, res) => {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: req.accountId! } });
  if (await prisma.member.findUnique({ where: { accountId: account.id }, select: { id: true } })) throw new HttpError(409, "You have already submitted your bio data.");
  if (!req.body.dob) throw new HttpError(422, "Enter a valid date of birth (18 years or older).", { fields: { dob: "Enter a valid date of birth (18 years or older)" } });
  const input = intakeSchema.parse({ ...req.body, email: account.email });
  const f = req.files as Record<string, Express.Multer.File[]> | undefined;
  const photos = f?.photo ?? [];
  const big = photos.find((x) => x.size > MAX_PHOTO_BYTES);
  if (big) {
    const msg = `A photo is ${(big.size / 1048576).toFixed(1)} MB. Photos must be 5 MB or smaller.`;
    throw new HttpError(422, msg, { fields: { photos: msg } });
  }
  if (photos.some((x) => !x.mimetype.startsWith("image/"))) throw new HttpError(422, "Photos must be JPG, PNG or WebP.", { fields: { photos: "Photos must be JPG, PNG or WebP." } });
  const photoUrls = await Promise.all(photos.map((x) => saveUpload("photos", x)));
  const biodataFileUrl = f?.biodata?.[0] ? await saveUpload("docs", f.biodata[0]) : undefined;
  let m;
  try { m = await createSubmission(input, "WEB", { photoUrls, biodataFileUrl }, account.id); }
  catch (e) { await Promise.all([...photoUrls.map((u) => removeObject(u)), removeObject(biodataFileUrl)]); throw e; }
  res.status(201).json({ ok: true, reference: m.profileCode, token: signToken({ kind: "member", id: m.id }) });
}));
