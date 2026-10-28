/**
 * One-off: files the tag-backed values of every existing member into their tag category.
 *
 * learnTagValues() runs on every submission and edit from now on, so this is only needed once, to
 * catch up the members who were entered before that existed. Safe to re-run: values already on a
 * list are reused, not duplicated.
 *
 *   npx tsx scripts/backfill-tags.ts          # report only, writes nothing
 *   npx tsx scripts/backfill-tags.ts --apply  # write the values
 */
import { prisma } from "../src/lib/db";
import { learnTagValues, TAG_FIELD_CATEGORIES } from "../src/lib/tags";

const FIELDS = Object.keys(TAG_FIELD_CATEGORIES) as (keyof typeof TAG_FIELD_CATEGORIES)[];

async function main() {
  const apply = process.argv.includes("--apply");
  const members = await prisma.member.findMany({
    select: { id: true, profileCode: true, ...Object.fromEntries(FIELDS.map((f) => [f, true])) } as never,
  }) as unknown as ({ id: string; profileCode: string } & Record<string, string | null>)[];

  console.log(`${members.length} member(s); ${apply ? "APPLYING" : "dry run, pass --apply to write"}\n`);
  let corrected = 0;

  for (const m of members) {
    const fields = Object.fromEntries(FIELDS.map((f) => [f, m[f]]));
    if (!apply) {
      const filled = FIELDS.filter((f) => m[f]?.trim()).map((f) => `${f}="${m[f]}"`);
      if (filled.length) console.log(`  ${m.profileCode}: ${filled.join(", ")}`);
      continue;
    }
    const fixes = await learnTagValues(fields);
    if (Object.keys(fixes).length) {
      await prisma.member.update({ where: { id: m.id }, data: fixes });
      corrected++;
      console.log(`  ${m.profileCode}: normalised ${JSON.stringify(fixes)}`);
    }
  }

  if (apply) {
    const cats = await prisma.tagCategory.findMany({ include: { values: true }, orderBy: { name: "asc" } });
    console.log(`\n${corrected} member(s) normalised. Tag lists now:`);
    for (const c of cats) console.log(`  ${c.name} (${c.values.length}): ${c.values.map((v) => v.value).sort().join(", ")}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
