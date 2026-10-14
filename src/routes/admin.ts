import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { HttpError, wrap } from "../lib/http";
import { requireAdmin } from "../lib/auth";
import { includeTags } from "../lib/matching";
import { toAdminMember } from "../lib/serializers";
import { audit, tempPassword } from "../lib/util";
import { sendApproved, sendCorrection, sendCredentials, sendRejection, sendSuggestion } from "../lib/notify";
import { config } from "../lib/config";
import { createSubmission, intakeSchema } from "./public";
import { removeObject, resolveUrl } from "../lib/storage";

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
const listQuery = z.object({
  status: z.string().optional(), q: z.string().trim().optional(), gender: z.string().optional(),
  city: z.string().optional(), community: z.string().optional(), tag: z.string().optional(),
  ageMin: z.coerce.number().optional(), ageMax: z.coerce.number().optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
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
  return w;
}

adminRouter.get("/members", wrap(async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = buildWhere(q);
  const [total, rows] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.findMany({ where, include: includeTags, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({ total, page: q.page, pageSize: q.pageSize, items: await Promise.all(rows.map(toAdminMember)) });
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
  const [likesGiven, likesReceived, intros, overrides, suggestions] = await Promise.all([
    prisma.like.findMany({ where: { likerId: m.id }, include: { liked: { select: { id: true, profileCode: true, fullName: true } } } }),
    prisma.like.count({ where: { likedId: m.id } }),
    prisma.introRequest.findMany({ where: { requesterId: m.id }, include: { target: { select: { id: true, profileCode: true, fullName: true } } } }),
    prisma.visibilityOverride.findMany({ where: { viewerId: m.id }, include: { profile: { select: { id: true, profileCode: true, fullName: true } } } }),
    prisma.suggestion.findMany({ where: { viewerId: m.id }, orderBy: { createdAt: "desc" }, include: { profile: { select: { id: true, profileCode: true, fullName: true, gender: true, city: true, photoUrl: true } } } }),
  ]);
  res.json({ ...(await toAdminMember(m)), likesGiven, likesReceived, intros, overrides, suggestions });
}));

// Manual entry by admin (walk-in / phone enquiry)
adminRouter.post("/members", wrap(async (req, res) => {
  const m = await createSubmission(intakeSchema.parse({ consent: true, ...req.body }), "ADMIN");
  await audit(adminId(req), "CREATE", "Member", m.id);
  res.status(201).json({ id: m.id, profileCode: m.profileCode });
}));

const editSchema = z.object({
  fullName: z.string().trim().min(2), phone: z.string().trim(), email: z.string().trim().nullable(),
  familyPhone: z.string().trim().nullable(), familyEmail: z.string().trim().nullable(),
  gender: z.enum(["MALE", "FEMALE"]), heightCm: z.number().int().nullable(), maritalStatus: z.string().nullable(),
  community: z.string().nullable(), subCommunity: z.string().nullable(), city: z.string().nullable(), state: z.string().nullable(),
  education: z.string().nullable(), profession: z.string().nullable(), income: z.string().nullable(), diet: z.string().nullable(),
  fatherOccupation: z.string().nullable(), motherOccupation: z.string().nullable(), siblings: z.string().nullable(),
  familyBackground: z.string().nullable(), about: z.string().nullable(), prefAgeMin: z.number().int().nullable(), prefAgeMax: z.number().int().nullable(),
  prefNotes: z.string().nullable(), adminNote: z.string().nullable(),
  motherTongue: z.string().nullable(), fatherName: z.string().nullable(), motherName: z.string().nullable(), familyType: z.string().nullable(), createdBy: z.string().nullable(),
  nativePlace: z.string().nullable(), prefHeightMinCm: z.number().int().nullable(), prefMaritalStatus: z.string().nullable(), prefRelocate: z.string().nullable(),
  prefCommunities: z.array(z.string()), prefCities: z.array(z.string()),
}).partial();

adminRouter.patch("/members/:id", wrap(async (req, res) => {
  const { prefCommunities, prefCities, ...d } = editSchema.parse(req.body);
  const m = await prisma.member.update({
    where: { id: pid(req.params.id) },
    data: { ...d, ...(prefCommunities && { prefCommunities: prefCommunities.join(",") }), ...(prefCities && { prefCities: prefCities.join(",") }) },
    include: includeTags,
  });
  await audit(adminId(req), "EDIT", "Member", m.id, { fields: Object.keys(req.body) });
  res.json(await toAdminMember(m));
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
adminRouter.delete("/members/:id", requireAdmin(["SUPER_ADMIN"]), wrap(async (req, res) => {
  const doomed = await prisma.member.findUnique({ where: { id: pid(req.params.id) }, include: { photos: true } });
  await prisma.member.delete({ where: { id: pid(req.params.id) } });
  if (doomed) await Promise.all([...doomed.photos.map((p) => removeObject(p.url)), removeObject(doomed.biodataFileUrl)]);
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
adminRouter.get("/suggestions", requireAdmin(["SUPER_ADMIN", "ADMIN"]), wrap(async (_req, res) => {
  const who = { select: { id: true, profileCode: true, fullName: true, gender: true, city: true } };
  res.json(await prisma.suggestion.findMany({ orderBy: { createdAt: "desc" }, take: 300, include: { viewer: who, profile: who } }));
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

adminRouter.get("/members/:id/document", wrap(async (req, res) => {
  const m = await prisma.member.findUnique({ where: { id: pid(req.params.id) } });
  if (!m?.biodataFileUrl) throw new HttpError(404, "No document uploaded.");
  res.json({ url: await resolveUrl(m.biodataFileUrl, 300) });
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
adminRouter.get("/likes", wrap(async (_req, res) => {
  res.json(await prisma.like.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { liker: { select: { id: true, profileCode: true, fullName: true, phone: true } }, liked: { select: { id: true, profileCode: true, fullName: true, phone: true } } } }));
}));
adminRouter.get("/introductions", wrap(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(await prisma.introRequest.findMany({
    where: status ? { status } : {}, orderBy: { createdAt: "desc" },
    include: { requester: { select: { id: true, profileCode: true, fullName: true, phone: true, email: true } }, target: { select: { id: true, profileCode: true, fullName: true, phone: true, email: true } } },
  }));
}));
adminRouter.patch("/introductions/:id", wrap(async (req, res) => {
  const d = z.object({ status: z.enum(["NEW", "UNDER_REVIEW", "INTRODUCTION_FACILITATED", "CLOSED"]), adminNote: z.string().trim().optional() }).parse(req.body);
  const r = await prisma.introRequest.update({ where: { id: pid(req.params.id) }, data: d });
  await audit(adminId(req), "INTRO_STATUS", "IntroRequest", r.id, d);
  res.json(r);
}));

// ---------- Messages, blog, content, audit ----------
adminRouter.get("/messages", wrap(async (_req, res) => { res.json(await prisma.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: 200 })); }));
adminRouter.patch("/messages/:id", wrap(async (req, res) => { res.json(await prisma.contactMessage.update({ where: { id: pid(req.params.id) }, data: { handled: !!req.body.handled } })); }));

// ---------- Announcements (members see these in their panel) ----------
const announcementSchema = z.object({ title: z.string().trim().min(3, "Enter a title"), body: z.string().trim().min(5, "Write the announcement"), active: z.boolean().default(true) });
adminRouter.get("/announcements", wrap(async (_req, res) => { res.json(await prisma.announcement.findMany({ orderBy: { createdAt: "desc" } })); }));
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
adminRouter.get("/notifications", wrap(async (_req, res) => {
  const rows = await prisma.notification.findMany({ where: { audience: "ADMIN" }, orderBy: { createdAt: "desc" }, take: 200 });
  const ids = [...new Set(rows.flatMap((n) => { try { const d = JSON.parse(n.data ?? "{}"); return [d.a, d.b]; } catch { return []; } }).filter(Boolean))] as string[];
  const people = await prisma.member.findMany({ where: { id: { in: ids } }, select: { id: true, profileCode: true, fullName: true, phone: true, photoUrl: true, gender: true } });
  const byId = new Map(await Promise.all(people.map(async (p) => [p.id, { ...p, photoUrl: await resolveUrl(p.photoUrl) }] as const)));
  res.json(rows.map((n) => { let d: { a?: string; b?: string } = {}; try { d = JSON.parse(n.data ?? "{}"); } catch {} return { ...n, a: byId.get(d.a ?? "") ?? null, b: byId.get(d.b ?? "") ?? null }; }));
}));
adminRouter.post("/notifications/read-all", wrap(async (_req, res) => { await prisma.notification.updateMany({ where: { audience: "ADMIN", read: false }, data: { read: true } }); res.json({ ok: true }); }));
adminRouter.patch("/notifications/:id", wrap(async (req, res) => { await prisma.notification.update({ where: { id: pid(req.params.id) }, data: { read: true } }); res.json({ ok: true }); }));

adminRouter.get("/audit", wrap(async (req, res) => {
  const t = typeof req.query.actor === "string" ? req.query.actor : "";
  const rows = await prisma.auditLog.findMany({
    where: t ? { actorType: t } : {}, orderBy: { createdAt: "desc" }, take: 300, include: { admin: { select: { name: true } } },
  });
  res.json(rows.map((l) => ({ id: l.id, actorType: l.actorType, actor: l.admin?.name ?? l.actorName ?? (l.actorType === "PUBLIC" ? "Website visitor" : "System"), action: l.action, entity: l.entity, entityId: l.entityId, detail: l.detail, createdAt: l.createdAt })));
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
