import crypto from "crypto";
import { prisma } from "./db";

export const ageFrom = (dob: Date) => {
  const n = new Date();
  let a = n.getFullYear() - dob.getFullYear();
  if (n < new Date(n.getFullYear(), dob.getMonth(), dob.getDate())) a--;
  return a;
};
export const list = (s?: string | null) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
export const tempPassword = () => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(10), (b) => c[b % c.length]).join("") + "@1";
};
/** Member IDs run sequentially from SS-1001. Derived from the highest code in use, not the row
 * count, so deleting a member never rewinds the sequence or reissues a retired ID. */
export const PROFILE_CODE_START = 1001;
export async function nextProfileCode() {
  const rows = await prisma.member.findMany({ select: { profileCode: true } });
  const highest = rows.reduce((max, { profileCode }) => {
    const n = /^SS-(\d+)$/.exec(profileCode);
    return n ? Math.max(max, parseInt(n[1], 10)) : max;
  }, PROFILE_CODE_START - 1);
  let next = highest + 1;
  // Guards against two submissions landing at once: step forward until the code is free.
  while (await prisma.member.findUnique({ where: { profileCode: `SS-${next}` } })) next++;
  return `SS-${next}`;
}
/** Normalises Indian mobile numbers to 10 digits so duplicates are detected reliably. */
export const normPhone = (p: string) => p.replace(/[^\d+]/g, "").replace(/^(\+?91)(?=\d{10}$)/, "");
/** Records anything a member or visitor does, so the admin Activity log shows everything. Never throws. */
export const activity = (who: { type: "MEMBER" | "PUBLIC"; memberId?: string; name?: string }, action: string, entity: string, entityId?: string, detail?: unknown) =>
  prisma.auditLog.create({ data: { actorType: who.type, memberId: who.memberId, actorName: who.name, action, entity, entityId, detail: detail ? JSON.stringify(detail) : undefined } }).catch(() => {});
export const memberLabel = (m: { profileCode: string; fullName: string }) => `${m.fullName} (${m.profileCode})`;
export const audit = (adminId: string | undefined, action: string, entity: string, entityId?: string, detail?: unknown) =>
  prisma.auditLog.create({ data: { adminId, action, entity, entityId, detail: detail ? JSON.stringify(detail) : undefined } });
