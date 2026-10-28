import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { HttpError, wrap } from "../lib/http";
import { requireApproved, requireMember } from "../lib/auth";
import { matchesFor, filterOptionsFor, includeTags, mutualIds, suggestionsFor } from "../lib/matching";
import { toContactProfile, toMutualProfile, toPublicProfile, toSelf } from "../lib/serializers";
import { learnTagValuesFor } from "../lib/tags";
import { activity, list, memberLabel } from "../lib/util";
import { checkAnyPhone, type CountryCode } from "../lib/phone";
import { verifyCity } from "../lib/cities";
import { sendMutualMatch } from "../lib/notify";
import { sendPush } from "../lib/fcm";
import { photoUpload, weightKgField } from "./public";
import { removeObject, saveUpload } from "../lib/storage";

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
const loadMe = (id: string) => prisma.member.findUniqueOrThrow({ where: { id }, include: includeTags });
const who = (m: { id: string; profileCode: string; fullName: string }) => ({ type: "MEMBER" as const, memberId: m.id, name: memberLabel(m) });

/** Keeps Member.photoUrl equal to the chosen main photo (used for cards and lists). */
async function syncMainPhoto(memberId: string) {
  let main = await prisma.photo.findFirst({ where: { memberId, isMain: true } });
  if (!main) {
    main = await prisma.photo.findFirst({ where: { memberId }, orderBy: { createdAt: "asc" } });
    if (main) await prisma.photo.update({ where: { id: main.id }, data: { isMain: true } });
  }
  await prisma.member.update({ where: { id: memberId }, data: { photoUrl: main?.url ?? null } });
}

// ---------- Account ----------
memberRouter.get("/me", wrap(async (req, res) => { res.json(await toSelf(await loadMe(me(req)))); }));

// ---------- FCM token ----------
memberRouter.patch("/fcm-token", wrap(async (req, res) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
  await prisma.member.update({ where: { id: me(req) }, data: { fcmToken: token } });
  res.json({ ok: true });
}));

// Only contact details are editable by the member. Bio data changes go through the admin.
memberRouter.patch("/me", wrap(async (req, res) => {
  const d = z.object({
    phone: z.string().transform((v, ctx) => { const r = checkAnyPhone(v); if (!r.ok) { ctx.addIssue({ code: "custom", message: r.error }); return z.NEVER; } return r.value; }).optional(),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => null)),
    familyPhone: z.string().transform((v, ctx) => { const r = checkAnyPhone(v); if (!r.ok) { ctx.addIssue({ code: "custom", message: r.error }); return z.NEVER; } return r.value; }).optional(),
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

// All profile fields except fullName are self-editable. Contact/phone changes still go through PATCH /member/me.
memberRouter.patch("/profile", wrap(async (req, res) => {
  const str = z.string().trim().max(2000).optional();
  const num = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().optional());
  const arr = z.preprocess((v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
    return undefined;
  }, z.array(z.string().trim()).optional());

  const d = z.object({
    gender: z.string().trim().toUpperCase().pipe(z.enum(["MALE", "FEMALE"])).optional(),
    dob: z.string().refine((s) => { const d = new Date(s); const age = (Date.now() - d.getTime()) / 31557600000; return !isNaN(d.getTime()) && age >= 18 && age <= 80; }, "Enter a valid date of birth (18 years or older)").optional(),
    heightCm: num, weightKg: weightKgField,
    maritalStatus: str, motherTongue: str, diet: str, createdBy: str,
    community: str, subCommunity: str,
    city: str, state: str, nativePlace: str,
    education: str, profession: str, income: str, about: str,
    fatherName: str, fatherOccupation: str,
    motherName: str, motherOccupation: str,
    siblings: str, familyType: str, familyBackground: str,
    prefAgeMin: num, prefAgeMax: num, prefHeightMinCm: num,
    prefMaritalStatus: str, prefRelocate: str, prefIncomeMin: str, prefNotes: str,
    prefCommunities: arr, prefCities: arr, prefEducation: arr, prefOccupation: arr, prefCountries: arr,
  }).parse(req.body);

  const { prefCommunities, prefCities, prefEducation, prefOccupation, prefCountries, dob, city, state, ...rest } = d;

  // Verify city against member's country
  let resolvedCity = city, resolvedState = state;
  if (city) {
    const member = await loadMe(me(req));
    const hit = verifyCity((member.country || "IN") as CountryCode, city, state);
    if (!hit) throw new HttpError(422, `We could not find "${city}". Please pick a city from the suggestions.`, { fields: { city: `"${city}" was not found in our city list.` } });
    resolvedCity = hit.name; resolvedState = hit.state || state;
  }

  const data: Record<string, unknown> = { ...rest };
  if (resolvedCity !== undefined) data.city = resolvedCity;
  if (resolvedState !== undefined) data.state = resolvedState;
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
  const hasMain = !!(await prisma.photo.findFirst({ where: { memberId: me(req), isMain: true } }));
  if (wantMain >= 0 && files[wantMain]) await prisma.photo.updateMany({ where: { memberId: me(req) }, data: { isMain: false } });
  const keys = await Promise.all(files.map((f) => saveUpload("photos", f)));
  for (const [i, key] of keys.entries()) {
    await prisma.photo.create({ data: { memberId: me(req), url: key, isMain: wantMain >= 0 ? i === wantMain : !hasMain && i === 0 } });
  }
  await syncMainPhoto(me(req));
  const m = await loadMe(me(req));
  await activity(who(m), "UPLOADED_PHOTOS", "Photo", undefined, { count: files.length });
  res.status(201).json((await toSelf(m)).photos);
}));

memberRouter.patch("/photos/:id/main", wrap(async (req, res) => {
  const p = await prisma.photo.findFirst({ where: { id: String(req.params.id), memberId: me(req) } });
  if (!p) throw new HttpError(404, "Photo not found.");
  await prisma.$transaction([
    prisma.photo.updateMany({ where: { memberId: me(req) }, data: { isMain: false } }),
    prisma.photo.update({ where: { id: p.id }, data: { isMain: true } }),
  ]);
  await syncMainPhoto(me(req));
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
memberRouter.get("/matches", wrap(async (req, res) => {
  const csv = z.string().optional().transform((v) => { const l = list(v); return l.length ? l : undefined; });
  const num = z.coerce.number().int().min(0).optional();
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(12),
    ageMin: num, ageMax: num, heightMin: num, heightMax: num,
    city: csv, maritalStatus: csv, education: csv, profession: csv, diet: csv, community: csv,
    subCommunity: csv, state: csv, motherTongue: csv, familyType: csv, nativePlace: csv,
    hasPhoto: z.enum(["1", "true"]).optional().transform((v) => (v ? true : undefined)),
    justJoined: z.enum(["1", "true"]).optional().transform((v) => (v ? true : undefined)),
    nearby: z.enum(["1", "true"]).optional().transform((v) => (v ? true : undefined)),
    code: z.string().trim().max(20).optional(),
    sort: z.enum(["new", "ageAsc", "ageDesc", "heightAsc", "heightDesc"]).optional(),
  }).parse(req.query);
  const { page: _p, pageSize: _s, ...filters } = q;
  const [all, mutual, likes, suggested] = await Promise.all([
    matchesFor(me(req), filters), mutualIds(me(req)),
    prisma.like.findMany({ where: { likerId: me(req) }, select: { likedId: true } }),
    suggestionsFor(me(req)),
  ]);
  const liked = new Set(likes.map((l) => l.likedId));
  const slice = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  res.json({
    total: all.length, page: q.page, pageSize: q.pageSize,
    items: await Promise.all(slice.map(async (m) => ({ ...(await (mutual.has(m.id) ? toMutualProfile(m) : toPublicProfile(m))), liked: liked.has(m.id), mutual: mutual.has(m.id), suggested: suggested.has(m.id) }))),
  });
}));

memberRouter.get("/matches/filter-options", wrap(async (req, res) => {
  res.json(await filterOptionsFor(me(req)));
}));

/** A profile can be opened if it is in the viewer's curated feed, or if the two members liked each other. */
async function loadVisible(viewerId: string, profileId: string) {
  const [feed, mutual] = await Promise.all([matchesFor(viewerId), mutualIds(viewerId)]);
  const isMutual = mutual.has(profileId);
  const p = feed.find((m) => m.id === profileId) ?? (isMutual ? await prisma.member.findFirst({ where: { id: profileId, status: "APPROVED" }, include: includeTags }) : null);
  if (!p) throw new HttpError(404, "This profile is not available.");
  return { p, isMutual };
}

memberRouter.get("/profiles/:id", wrap(async (req, res) => {
  const { p, isMutual } = await loadVisible(me(req), String(req.params.id));
  const [like, introByMe, introByThem, sug] = await Promise.all([
    prisma.like.findUnique({ where: { likerId_likedId: { likerId: me(req), likedId: p.id } } }),
    prisma.introRequest.findUnique({ where: { requesterId_targetId: { requesterId: me(req), targetId: p.id } } }),
    prisma.introRequest.findUnique({ where: { requesterId_targetId: { requesterId: p.id, targetId: me(req) } } }),
    prisma.suggestion.findUnique({ where: { viewerId_profileId: { viewerId: me(req), profileId: p.id } } }),
  ]);
  // Viewer sees contact details when either party's intro request was facilitated
  const activeIntro = introByMe ?? introByThem;
  const contactVisible = activeIntro?.status === "INTRODUCTION_FACILITATED";
  const serialized = contactVisible ? await toContactProfile(p) : isMutual ? await toMutualProfile(p) : await toPublicProfile(p);
  res.json({
    ...serialized, liked: !!like, mutual: isMutual, suggested: !!sug, suggestionNote: sug?.note ?? null,
    introduction: activeIntro ? { status: activeIntro.status, label: STATUS_LABEL[activeIntro.status] } : null,
    contactVisible,
  });
}));

// ---------- Likes ----------
memberRouter.put("/likes/:id", requireApproved, wrap(async (req, res) => {
  const { p } = await loadVisible(me(req), String(req.params.id));
  const existing = await prisma.like.findUnique({ where: { likerId_likedId: { likerId: me(req), likedId: p.id } } });
  let mutual = false;
  if (!existing) {
    await prisma.like.create({ data: { likerId: me(req), likedId: p.id } });
    const meRow = await prisma.member.findUniqueOrThrow({ where: { id: me(req) } });
    await activity(who(meRow), "LIKED_PROFILE", "Member", p.id, { profile: p.profileCode });
    const back = await prisma.like.findUnique({ where: { likerId_likedId: { likerId: p.id, likedId: me(req) } } });
    if (back) {
      mutual = true;
      const first = (n: string) => n.split(" ")[0];
      await prisma.$transaction([
        // the person who liked first
        prisma.notification.create({ data: { audience: "MEMBER", memberId: p.id, type: "MUTUAL_LIKE", title: "It's a match! 💞",
          body: `${first(meRow.fullName)} (${meRow.profileCode}) liked your profile as well. You can now view their profile properly.`, data: JSON.stringify({ memberId: meRow.id }) } }),
        // the person who just liked
        prisma.notification.create({ data: { audience: "MEMBER", memberId: meRow.id, type: "MUTUAL_LIKE", title: "It's a match! 💞",
          body: `${first(p.fullName)} (${p.profileCode}) had already liked you. You can now view their profile properly.`, data: JSON.stringify({ memberId: p.id }) } }),
        // staff bell
        prisma.notification.create({ data: { audience: "ADMIN", type: "MUTUAL_LIKE", title: "Mutual like",
          body: `${memberLabel(meRow)} and ${memberLabel(p)} liked each other.`, data: JSON.stringify({ a: meRow.id, b: p.id }) } }),
      ]);
      await activity(who(meRow), "MUTUAL_MATCH", "Member", p.id, { with: p.profileCode });
      // email + SMS to both people (each call is best-effort and never throws)
      await Promise.all([sendMutualMatch(meRow, p), sendMutualMatch(p, meRow)]);
      // push to both members — must be awaited before res.json() or Vercel kills the fn
      await Promise.allSettled([
        sendPush(meRow.fcmToken, "You have a new match! 💞", `You and ${first(p.fullName)} liked each other.`, { type: "MUTUAL_LIKE", memberId: p.id }),
        sendPush(p.fcmToken, "You have a new match! 💞", `You and ${first(meRow.fullName)} liked each other.`, { type: "MUTUAL_LIKE", memberId: meRow.id }),
      ]);
    } else {
      // not mutual yet — notify the liked person
      await sendPush(p.fcmToken, "Someone liked your profile! 💌", "Check who liked you on Sathsangath.", { type: "LIKE_RECEIVED" });
    }
  } else mutual = (await mutualIds(me(req))).has(p.id);
  res.json({ liked: true, mutual });
}));

memberRouter.delete("/likes/:id", requireApproved, wrap(async (req, res) => {
  const otherId = String(req.params.id);
  const r = await prisma.like.deleteMany({ where: { likerId: me(req), likedId: otherId } });
  if (r.count) {
    const m = await prisma.member.findUniqueOrThrow({ where: { id: me(req) } });
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

memberRouter.get("/likes/received", wrap(async (req, res) => {
  const [likes, mutual] = await Promise.all([
    prisma.like.findMany({ where: { likedId: me(req), liker: { status: "APPROVED" } }, include: { liker: { include: includeTags } }, orderBy: { createdAt: "desc" } }),
    mutualIds(me(req)),
  ]);
  res.json(await Promise.all(likes.map(async (l) => {
    const isMutual = mutual.has(l.likerId);
    return { ...(await (isMutual ? toMutualProfile(l.liker) : toPublicProfile(l.liker))), liked: isMutual, mutual: isMutual, likedAt: l.createdAt };
  })));
}));

memberRouter.get("/likes", wrap(async (req, res) => {
  const [likes, mutual, intros, suggested] = await Promise.all([
    prisma.like.findMany({ where: { likerId: me(req), liked: { status: "APPROVED" } }, include: { liked: { include: includeTags } }, orderBy: { createdAt: "desc" } }),
    mutualIds(me(req)),
    prisma.introRequest.findMany({ where: { requesterId: me(req) } }),
    suggestionsFor(me(req)),
  ]);
  const byTarget = new Map(intros.map((i) => [i.targetId, i]));
  res.json(await Promise.all(likes.map(async (l) => {
    const i = byTarget.get(l.likedId); const isMutual = mutual.has(l.likedId);
    return { ...(await (isMutual ? toMutualProfile(l.liked) : toPublicProfile(l.liked))), liked: true, mutual: isMutual, suggested: suggested.has(l.likedId), likedAt: l.createdAt, introduction: i ? { status: i.status, label: STATUS_LABEL[i.status] } : null };
  })));
}));

/** "Suggested by Sathsangath": profiles our team hand-picked for this member (newest first). */
memberRouter.get("/suggestions", wrap(async (req, res) => {
  const [rows, likes, mutual, intros] = await Promise.all([
    prisma.suggestion.findMany({ where: { viewerId: me(req), profile: { status: "APPROVED" } }, orderBy: { createdAt: "desc" }, include: { profile: { include: includeTags } } }),
    prisma.like.findMany({ where: { likerId: me(req) }, select: { likedId: true } }),
    mutualIds(me(req)),
    prisma.introRequest.findMany({ where: { requesterId: me(req) } }),
  ]);
  const liked = new Set(likes.map((l) => l.likedId)); const byTarget = new Map(intros.map((i) => [i.targetId, i]));
  res.json(await Promise.all(rows.map(async (r) => {
    const isMutual = mutual.has(r.profileId); const i = byTarget.get(r.profileId);
    return { ...(await (isMutual ? toMutualProfile(r.profile) : toPublicProfile(r.profile))), liked: liked.has(r.profileId), mutual: isMutual, suggested: true, suggestionNote: r.note, suggestedAt: r.createdAt, introduction: i ? { status: i.status, label: STATUS_LABEL[i.status] } : null };
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
  const m = await prisma.member.findUniqueOrThrow({ where: { id: me(req) } });
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
