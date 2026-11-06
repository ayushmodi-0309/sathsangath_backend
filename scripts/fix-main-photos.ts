/**
 * One-off: repairs members who ended up with more than one main photo, and
 * members whose `photoUrl` no longer points at their main photo.
 *
 * The admin edit route marked the first photo of every upload as main without
 * demoting the one before it, so a member photographed over several saves wore
 * a "Main photo" badge on each of them in the app and on the web. That route
 * now hands the decision to syncMainPhoto; this catches up the rows written
 * before it did.
 *
 * By default the photo kept is the oldest of the duplicates: the one the
 * admin page and the member's own gallery have been showing as main all along
 * (both order by isMain, then oldest first). `--keep-newest` keeps the latest
 * upload instead, which is what the cards and lists have been showing, since
 * each upload also re-pointed Member.photoUrl at itself.
 *
 * Safe to re-run: a member already in order is left alone.
 *
 *   npx tsx scripts/fix-main-photos.ts                      # report only, writes nothing
 *   npx tsx scripts/fix-main-photos.ts --apply              # keep the oldest main photo
 *   npx tsx scripts/fix-main-photos.ts --apply --keep-newest
 */
import { prisma } from "../src/lib/db";
import { syncMainPhoto } from "../src/lib/photos";

async function main() {
  const apply = process.argv.includes("--apply");
  const keepNewest = process.argv.includes("--keep-newest");
  const members = await prisma.member.findMany({
    select: {
      id: true,
      profileCode: true,
      photoUrl: true,
      photos: { select: { id: true, url: true, isMain: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { profileCode: "asc" },
  });

  console.log(
    `${members.length} member(s); ${apply ? "APPLYING" : "dry run, pass --apply to write"}` +
      `; keeping the ${keepNewest ? "newest" : "oldest"} main photo\n`,
  );
  let broken = 0;

  for (const m of members) {
    const mains = m.photos.filter((p) => p.isMain);
    const keep = (keepNewest ? mains[mains.length - 1] : mains[0]) ?? m.photos[0] ?? null;
    const extras = mains.length > 1 ? mains.length - 1 : 0;
    const noMain = m.photos.length > 0 && mains.length === 0;
    const staleUrl = (m.photoUrl ?? null) !== (keep?.url ?? null);
    if (!extras && !noMain && !staleUrl) continue;

    broken++;
    const why = [
      extras ? `${extras} extra main photo(s) demoted` : null,
      noMain ? "no main photo, oldest promoted" : null,
      staleUrl ? "photoUrl re-pointed at the main photo" : null,
    ].filter(Boolean).join("; ");
    console.log(`  ${m.profileCode} (${m.photos.length} photo(s)): ${why}`);
    if (apply) await syncMainPhoto(m.id, keep?.id);
  }

  console.log(
    broken === 0
      ? "\nNothing to fix: every member has exactly one main photo."
      : `\n${broken} member(s) ${apply ? "fixed" : "would be fixed"}.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
