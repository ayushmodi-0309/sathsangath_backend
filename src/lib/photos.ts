import { prisma } from "./db";

/**
 * Two invariants about a member's photos, in one place:
 *
 *  1. exactly one photo carries `isMain` — the gallery draws a "Main photo"
 *     badge from it, so a second one shows up as a second main photo;
 *  2. `Member.photoUrl` mirrors that photo, because cards and lists read the
 *     member row rather than the photo rows.
 *
 * Call this after anything that adds, removes or re-points photos. It repairs
 * what it finds, so a member left with several mains by an earlier write is
 * put right the next time their photos are touched.
 *
 * `prefer` names the photo that should end up main; without it the current
 * main is kept, and failing that the oldest photo is promoted.
 */
export async function syncMainPhoto(memberId: string, prefer?: string) {
  const photos = await prisma.photo.findMany({
    where: { memberId },
    orderBy: { createdAt: "asc" },
  });
  const main =
    (prefer ? photos.find((p) => p.id === prefer) : undefined) ??
    photos.find((p) => p.isMain) ??
    photos[0] ??
    null;

  const demote = photos.filter((p) => p.isMain && p.id !== main?.id).map((p) => p.id);
  await prisma.$transaction([
    ...(demote.length
      ? [prisma.photo.updateMany({ where: { id: { in: demote } }, data: { isMain: false } })]
      : []),
    ...(main && !main.isMain
      ? [prisma.photo.update({ where: { id: main.id }, data: { isMain: true } })]
      : []),
    prisma.member.update({ where: { id: memberId }, data: { photoUrl: main?.url ?? null } }),
  ]);
  return main;
}
