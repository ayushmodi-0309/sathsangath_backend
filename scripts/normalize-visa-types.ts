/**
 * One-off: rewrites the shorter visa labels earlier builds of the app and the
 * member profile editor stored ("Work visa", "Dependent / spouse visa") to the
 * canonical ones in VISA_TYPES, which is the list the API validates against.
 *
 * normalizeVisaType() now runs on every submission and edit, so a stale value
 * is corrected the next time that member is saved. This catches up the rows
 * nobody has touched since. Safe to re-run: a canonical value is left alone.
 *
 *   npx tsx scripts/normalize-visa-types.ts          # report only, writes nothing
 *   npx tsx scripts/normalize-visa-types.ts --apply  # write the values
 */
import { prisma } from "../src/lib/db";
import { normalizeVisaType, VISA_TYPES } from "../src/routes/public";

async function main() {
  const apply = process.argv.includes("--apply");
  const members = await prisma.member.findMany({
    where: { NOT: { visaType: null } },
    select: { id: true, profileCode: true, visaType: true },
    orderBy: { profileCode: "asc" },
  });

  const stale = members.filter((m) => normalizeVisaType(m.visaType) !== m.visaType);
  const unknown = members.filter(
    (m) => !(VISA_TYPES as readonly string[]).includes(normalizeVisaType(m.visaType)!),
  );

  console.log(`${members.length} member(s) with a visa status; ${stale.length} to rewrite; ${apply ? "APPLYING" : "dry run, pass --apply to write"}\n`);

  for (const m of stale) {
    const next = normalizeVisaType(m.visaType)!;
    console.log(`  ${m.profileCode}: "${m.visaType}" -> "${next}"`);
    if (apply) await prisma.member.update({ where: { id: m.id }, data: { visaType: next } });
  }

  if (unknown.length) {
    console.log(`\n${unknown.length} value(s) still off VISA_TYPES — these need a decision by hand:`);
    for (const m of unknown) console.log(`  ${m.profileCode}: "${m.visaType}"`);
  }

  console.log(apply ? `\nDone: ${stale.length} rewritten.` : "\nNothing written.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
