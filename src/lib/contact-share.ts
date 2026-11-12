import { prisma } from "./db";

/** The pair is stored once, smaller id first, so (a, b) and (b, a) are the same row. */
export const pair = (a: string, b: string) => (a < b ? { memberAId: a, memberBId: b } : { memberAId: b, memberBId: a });

/** Whether our team has approved these two members to see each other's mobile number and email. */
export async function isContactShared(a: string, b: string) {
  try {
    return !!(await prisma.contactShare.findUnique({ where: { memberAId_memberBId: pair(a, b) }, select: { id: true } }));
  } catch (e) {
    console.error("contactShare lookup failed (run `prisma db push`?):", (e as Error).message); // never break a profile page over this
    return false;
  }
}

/** Both members have liked each other. */
export async function areMutual(a: string, b: string) {
  const n = await prisma.like.count({ where: { OR: [{ likerId: a, likedId: b }, { likerId: b, likedId: a }] } });
  return n === 2;
}
