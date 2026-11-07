import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../lib/db";
import { HttpError, wrap } from "../lib/http";
import { signToken, requireMember, requireAdmin, normaliseRole } from "../lib/auth";
import { activity, audit, memberLabel, normPhone } from "../lib/util";
import { toSelf } from "../lib/serializers";
import { includeTags } from "../lib/matching";
import { verifyFirebaseIdToken } from "../lib/firebase";
import { sendPasswordReset } from "../lib/notify";
import { config } from "../lib/config";

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { error: "Too many login attempts. Please try again in 15 minutes." } });

/** A member names themselves by Member ID, mobile number or email - the same three ways everywhere. */
const whereByUsername = (username: string) =>
  username.toUpperCase().startsWith("SS-")
    ? { profileCode: username.toUpperCase() }
    : username.includes("@")
      ? { email: { equals: username, mode: "insensitive" as const } }
      : { phone: normPhone(username) };

const passwordRule = z.string().min(8, "Use at least 8 characters").regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number");

// Member login: mobile number OR profile code + password
authRouter.post("/login", loginLimiter, wrap(async (req, res) => {
  const { username, password } = z.object({ username: z.string().trim().min(3, "Enter your mobile number, Member ID or email"), password: z.string().min(1, "Enter your password") }).parse(req.body);
  // Three ways to name yourself: Member ID, mobile number, or the email on the profile.
  const where = whereByUsername(username);
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

// Also used to CREATE a first password: a member who signed up with Google has no password
// yet, so there is no current one to ask for. They keep Google sign-in and gain the
// Member ID / mobile + password login as a second way in.
authRouter.post("/change-password", requireMember, wrap(async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().optional(), newPassword: passwordRule }).parse(req.body);
  const m = await prisma.member.findUniqueOrThrow({ where: { id: req.actor!.id } });
  if (m.passwordHash) {
    if (!currentPassword) throw new HttpError(422, "Enter your current password.", { fields: { currentPassword: "Enter your current password" } });
    if (!(await bcrypt.compare(currentPassword, m.passwordHash))) throw new HttpError(422, "Current password is incorrect.", { fields: { currentPassword: "Current password is incorrect" } });
    if (currentPassword === newPassword) throw new HttpError(422, "Choose a different password from the current one.");
  }
  await prisma.member.update({ where: { id: m.id }, data: { passwordHash: await bcrypt.hash(newPassword, 11), mustChangePassword: false } });
  await activity({ type: "MEMBER", memberId: m.id, name: memberLabel(m) }, m.passwordHash ? "CHANGED_PASSWORD" : "CREATED_PASSWORD", "Member", m.id);
  res.json({ ok: true });
}));

// ---------- Forgot password (self-serve) ----------
// A one-time link is emailed and texted to the member. It works for everyone, including members
// who signed up with Google and never had a password: using the link gives them one.
const RESET_MINUTES = 30;
// Asking is the expensive half (every request sends an email and an SMS), so it is the stricter
// of the two. Using the link is kept separate and generous: a mistyped new password or an
// expired link must not leave someone unable to finish their reset.
const askLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: "Too many reset requests. Please try again in an hour." } });
const useLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { error: "Too many attempts. Please try again in 15 minutes." } });

/**
 * The link carries a short-lived signed token, so nothing is stored for it.
 *
 * The signature covers a fingerprint of the password it was issued against, which is what makes
 * it single-use: the moment it is used - or the password changes any other way - every link
 * issued before stops verifying. A member with no password yet fingerprints as "none", so their
 * first link stops working once it has given them one.
 */
const resetFingerprint = (passwordHash: string | null) =>
  crypto.createHash("sha256").update(passwordHash ?? "none").digest("hex").slice(0, 16);
const signResetToken = (m: { id: string; passwordHash: string | null }) =>
  jwt.sign({ kind: "reset", id: m.id, pw: resetFingerprint(m.passwordHash) }, config.jwtSecret, { expiresIn: `${RESET_MINUTES}m` });
const EXPIRED = "This reset link has expired or has already been used. Please ask for a new one.";

authRouter.post("/forgot-password", askLimiter, wrap(async (req, res) => {
  const { username } = z.object({ username: z.string().trim().min(3, "Enter your mobile number, Member ID or email") }).parse(req.body);
  const candidates = await prisma.member.findMany({ where: whereByUsername(username), take: 5 });
  // An email may name more than one profile; prefer one we can actually write to.
  const m = candidates.find((c) => c.email) ?? candidates[0];
  if (m && m.status !== "SUSPENDED" && m.status !== "REJECTED") {
    const delivery = await sendPasswordReset(m, `${config.webResetUrl}?token=${signResetToken(m)}`, RESET_MINUTES);
    await activity({ type: "MEMBER", memberId: m.id, name: memberLabel(m) }, "REQUESTED_PASSWORD_RESET", "Member", m.id, { delivery });
  }
  // Always the same answer, whether or not a profile matched: never confirm who is a member.
  res.json({ ok: true });
}));

authRouter.post("/reset-password", useLimiter, wrap(async (req, res) => {
  const { token, newPassword } = z.object({ token: z.string().min(20, "This reset link is not valid"), newPassword: passwordRule }).parse(req.body);
  let claim: { kind?: string; id?: string; pw?: string };
  try { claim = jwt.verify(token, config.jwtSecret) as typeof claim; } catch { throw new HttpError(410, EXPIRED); }
  // kind guards against a member's own session token being replayed here.
  if (claim.kind !== "reset" || !claim.id) throw new HttpError(410, EXPIRED);
  const m = await prisma.member.findUnique({ where: { id: claim.id } });
  if (!m || claim.pw !== resetFingerprint(m.passwordHash)) throw new HttpError(410, EXPIRED);
  if (m.status === "SUSPENDED" || m.status === "REJECTED") throw new HttpError(403, "Please contact Sathsangath about your account.");
  await prisma.member.update({ where: { id: m.id }, data: { passwordHash: await bcrypt.hash(newPassword, 11), mustChangePassword: false } });
  await activity({ type: "MEMBER", memberId: m.id, name: memberLabel(m) }, "RESET_PASSWORD", "Member", m.id);
  res.json({ ok: true });
}));

authRouter.post("/admin/login", loginLimiter, wrap(async (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().email("Enter a valid email"), password: z.string().min(1, "Enter your password") }).parse(req.body);
  const a = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  // One message for a wrong password, an unknown email and a deactivated login alike:
  // a deactivated staff member must not learn their login still exists.
  if (!a?.active || !(await bcrypt.compare(password, a.passwordHash))) throw new HttpError(401, "Incorrect email or password.");
  await audit(a.id, "LOGIN", "AdminUser", a.id);
  res.json({
    token: signToken({ kind: "admin", id: a.id, role: normaliseRole(a.role) }),
    admin: { id: a.id, name: a.name, email: a.email, role: normaliseRole(a.role), mustChangePassword: a.mustChangePassword },
  });
}));

authRouter.get("/admin/me", requireAdmin(), wrap(async (req, res) => {
  const a = await prisma.adminUser.findUniqueOrThrow({ where: { id: req.actor!.id } });
  res.json({ id: a.id, name: a.name, email: a.email, role: normaliseRole(a.role), mustChangePassword: a.mustChangePassword });
}));

/**
 * An admin changes their own password. The owner never learns it: the temporary
 * password they issue is replaced here, and mustChangePassword - which the portal
 * uses to hold a new staff member on this screen - is cleared only on success.
 */
authRouter.post("/admin/change-password", requireAdmin(), wrap(async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: passwordRule }).parse(req.body);
  const a = await prisma.adminUser.findUniqueOrThrow({ where: { id: req.actor!.id } });
  if (!(await bcrypt.compare(currentPassword, a.passwordHash))) throw new HttpError(422, "Current password is incorrect.", { fields: { currentPassword: "Current password is incorrect" } });
  if (currentPassword === newPassword) throw new HttpError(422, "Choose a different password from the current one.", { fields: { newPassword: "Choose a different password" } });
  await prisma.adminUser.update({ where: { id: a.id }, data: { passwordHash: await bcrypt.hash(newPassword, 11), mustChangePassword: false } });
  await audit(a.id, "CHANGED_PASSWORD", "AdminUser", a.id);
  res.json({ ok: true });
}));
