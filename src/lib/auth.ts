import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config";
import { HttpError } from "./http";
import { prisma } from "./db";

export type Actor = { kind: "admin" | "member" | "account"; id: string; role?: string };
declare global { namespace Express { interface Request { actor?: Actor; accountId?: string } } }

export const signToken = (a: Actor) =>
  jwt.sign(a, config.jwtSecret, { expiresIn: config.jwtExpires as jwt.SignOptions["expiresIn"] });

function readActor(req: Request): Actor {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) throw new HttpError(401, "Please log in to continue.");
  try { return jwt.verify(h.slice(7), config.jwtSecret) as Actor; }
  catch { throw new HttpError(401, "Your session has expired. Please log in again."); }
}

export const requireAdmin = (roles?: string[]) => async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const a = readActor(req);
    if (a.kind !== "admin") throw new HttpError(403, "Admin access only.");
    const admin = await prisma.adminUser.findUnique({ where: { id: a.id } });
    if (!admin?.active) throw new HttpError(401, "Account disabled.");
    if (roles && !roles.includes(admin.role)) throw new HttpError(403, "You do not have permission for this action.");
    req.actor = { ...a, role: admin.role };
    next();
  } catch (e) { next(e); }
};

/** Members who can browse: approved, plus those whose bio data is waiting for review or a correction. */
const BROWSE_STATUSES = ["PENDING", "CORRECTION", "APPROVED"];

export const requireMember = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const a = readActor(req);
    if (a.kind !== "member") throw new HttpError(403, "Member access only.");
    const m = await prisma.member.findUnique({ where: { id: a.id }, select: { status: true } });
    if (!m || !BROWSE_STATUSES.includes(m.status)) throw new HttpError(403, "Your account is not active. Please contact Sathsangath.");
    req.actor = { ...a, role: m.status };
    next();
  } catch (e) { next(e); }
};

/**
 * Everything another member is part of: seeing profiles, liking, asking for an
 * introduction. Until our team has approved the bio data a member only has
 * their own account — they can edit their profile, add photos and read their
 * updates, and nothing else. Their profile is equally invisible to others,
 * which `matchesFor` already handles by only ever listing APPROVED members.
 *
 * Use after requireMember, which has put the member's status on `actor.role`.
 */
export const requireApproved = (req: Request, _res: Response, next: NextFunction) => {
  const status = req.actor?.role;
  if (status === "APPROVED") return next();
  const message = status === "CORRECTION"
    ? "Our team has asked for a correction to your bio data. Profiles unlock once you update it and we approve it."
    : "Your bio data is still under review. Profiles unlock once Sathsangath approves it, usually within 2–3 working days.";
  next(new HttpError(403, message, undefined, "NOT_APPROVED"));
};

/** Signed-in Firebase user, with or without a Member row yet. Resolves req.accountId. */
export const requireAccount = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const a = readActor(req);
    if (a.kind === "account") { req.accountId = a.id; return next(); }
    if (a.kind !== "member") throw new HttpError(403, "Please sign in to continue.");
    const m = await prisma.member.findUnique({ where: { id: a.id }, select: { accountId: true } });
    if (!m?.accountId) throw new HttpError(403, "Please sign in with your email to continue.");
    req.accountId = m.accountId;
    next();
  } catch (e) { next(e); }
};
