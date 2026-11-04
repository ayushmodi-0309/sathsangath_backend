import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../lib/db";
import { HttpError, wrap } from "../lib/http";
import { signToken, requireMember, requireAdmin } from "../lib/auth";
import { activity, audit, memberLabel, normPhone } from "../lib/util";
import { toSelf } from "../lib/serializers";
import { includeTags } from "../lib/matching";
import { verifyFirebaseIdToken } from "../lib/firebase";

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { error: "Too many login attempts. Please try again in 15 minutes." } });

const passwordRule = z.string().min(8, "Use at least 8 characters").regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number");

// Member login: mobile number OR profile code + password
authRouter.post("/login", loginLimiter, wrap(async (req, res) => {
  const { username, password } = z.object({ username: z.string().trim().min(3, "Enter your mobile number, Member ID or email"), password: z.string().min(1, "Enter your password") }).parse(req.body);
  // Three ways to name yourself: Member ID, mobile number, or the email on the profile.
  const where = username.toUpperCase().startsWith("SS-")
    ? { profileCode: username.toUpperCase() }
    : username.includes("@")
      ? { email: { equals: username, mode: "insensitive" as const } }
      : { phone: normPhone(username) };
  // profileCode and phone are unique, but email is not, so an email may name more than one
  // profile. Pick the one whose password matches instead of guessing - that also avoids telling
  // an outsider which addresses are shared.
  const candidates = await prisma.member.findMany({ where, include: includeTags, take: 5 });
  let m: (typeof candidates)[number] | undefined;
  for (const c of candidates) if (c.passwordHash && (await bcrypt.compare(password, c.passwordHash))) { m = c; break; }
  if (!m) {
    await activity({ type: "PUBLIC", name: username }, "FAILED_LOGIN", "Member", candidates.length === 1 ? candidates[0].id : undefined);
    throw new HttpError(401, "Incorrect mobile number / Member ID or password.");
  }
  if (m.status === "SUSPENDED") throw new HttpError(403, "Your account is suspended. Please contact Sathsangath.");
  if (m.status === "REJECTED") throw new HttpError(403, "Your bio data could not be taken forward. Please contact Sathsangath.");
  // A profile waiting for review (or for a correction) can still sign in: they may fill in their bio
  // data, add photos and look around. The actions that need approval - liking, liking back, asking
  // for an introduction - are gated server-side by requireApproved, not by the login.
  await prisma.member.update({ where: { id: m.id }, data: { lastLoginAt: new Date() } });
  await activity({ type: "MEMBER", memberId: m.id, name: memberLabel(m) }, "LOGIN", "Member", m.id);
  res.json({ token: signToken({ kind: "member", id: m.id }), member: await toSelf(m) });
}));

// Firebase sign-in (email+password or Google). The browser/app signs in with Firebase and sends the ID token here.
// The email must be verified (Google accounts are verified automatically). Existing members are linked by email.
const firebaseLogin = wrap(async (req, res) => {
  const { idToken } = z.object({ idToken: z.string().min(20, "Missing sign-in token") }).parse(req.body);
  const g = await verifyFirebaseIdToken(idToken).catch(() => { throw new HttpError(401, "Sign-in could not be verified. Please try again."); });
  if (!g.email) throw new HttpError(403, "Your account does not have an email address.");
  if (!g.emailVerified) throw new HttpError(403, "Please verify your email address first.", { fields: { emailVerified: "false" } });
  const account = await prisma.account.upsert({
    where: { firebaseUid: g.uid },
    create: { firebaseUid: g.uid, email: g.email, lastLoginAt: new Date() },
    update: { email: g.email, lastLoginAt: new Date() },
  });
  let m = await prisma.member.findUnique({ where: { accountId: account.id }, include: includeTags });
  if (!m) {
    // Link a member who was registered earlier (admin entry / old form) with this verified email.
    const matches = await prisma.member.findMany({
      where: { accountId: null, OR: [{ email: { equals: g.email, mode: "insensitive" } }, { familyEmail: { equals: g.email, mode: "insensitive" } }] },
      include: includeTags,
    });
    if (matches.length > 1) throw new HttpError(409, "This email is linked to more than one profile. Please log in with your Member ID, or contact Sathsangath.");
    if (matches.length === 1) m = await prisma.member.update({ where: { id: matches[0].id }, data: { accountId: account.id }, include: includeTags });
  }
  if (!m) return res.json({ token: signToken({ kind: "account", id: account.id }), member: null });
  if (m.status === "SUSPENDED") throw new HttpError(403, "Your account is suspended. Please contact Sathsangath.");
  if (m.status === "REJECTED") throw new HttpError(403, "Your bio data could not be taken forward. Please contact Sathsangath.");
  await prisma.member.update({ where: { id: m.id }, data: { lastLoginAt: new Date() } });
  await activity({ type: "MEMBER", memberId: m.id, name: memberLabel(m) }, "LOGIN", "Member", m.id);
  res.json({ token: signToken({ kind: "member", id: m.id }), member: await toSelf(m) });
});
authRouter.post("/firebase", loginLimiter, firebaseLogin);
authRouter.post("/google", loginLimiter, firebaseLogin); // older clients

authRouter.post("/change-password", requireMember, wrap(async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: passwordRule }).parse(req.body);
  const m = await prisma.member.findUniqueOrThrow({ where: { id: req.actor!.id } });
  if (!m.passwordHash || !(await bcrypt.compare(currentPassword, m.passwordHash))) throw new HttpError(422, "Current password is incorrect.", { fields: { currentPassword: "Current password is incorrect" } });
  if (currentPassword === newPassword) throw new HttpError(422, "Choose a different password from the current one.");
  await prisma.member.update({ where: { id: m.id }, data: { passwordHash: await bcrypt.hash(newPassword, 11), mustChangePassword: false } });
  await activity({ type: "MEMBER", memberId: m.id, name: memberLabel(m) }, "CHANGED_PASSWORD", "Member", m.id);
  res.json({ ok: true });
}));

authRouter.post("/admin/login", loginLimiter, wrap(async (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().email("Enter a valid email"), password: z.string().min(1, "Enter your password") }).parse(req.body);
  const a = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  if (!a?.active || !(await bcrypt.compare(password, a.passwordHash))) throw new HttpError(401, "Incorrect email or password.");
  await audit(a.id, "LOGIN", "AdminUser", a.id);
  res.json({ token: signToken({ kind: "admin", id: a.id, role: a.role }), admin: { id: a.id, name: a.name, email: a.email, role: a.role } });
}));

authRouter.get("/admin/me", requireAdmin(), wrap(async (req, res) => {
  const a = await prisma.adminUser.findUniqueOrThrow({ where: { id: req.actor!.id } });
  res.json({ id: a.id, name: a.name, email: a.email, role: a.role });
}));
