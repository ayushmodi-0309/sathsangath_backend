/**
 * Clears the stored education and profession values so the closed lists start from a clean slate.
 *
 * Members typed these fields freely for a long time, so the columns hold hundreds of
 * near-duplicate spellings ("Dentist", "Physician", "MBBS Doctor"). The feed filter facets are
 * built by grouping over these columns, so the old values would keep appearing as filter chips
 * however clean the pickers became. Emptying them is what actually fixes the filters; members and
 * the office then re-pick from the fixed lists.
 *
 * Run with:
 *   npm run lists:reset              # report only, changes nothing
 *   npm run lists:reset -- --apply   # empty education and profession
 *
 * Extra, opt-in:
 *   --prefs      also empty prefEducation / prefOccupation (the partner-preference lists)
 *   --tags       also drop MemberTag rows pointing at Education / Profession values
 *
 * Take a dump first. `backups/README.md` has the restore commands.
 */

import { prisma } from "../src/lib/db";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const withPrefs = args.includes("--prefs");
const withTags = args.includes("--tags");

async function main() {
  const [education, profession, prefEducation, prefOccupation, memberTags] = await Promise.all([
    prisma.member.count({ where: { education: { not: null } } }),
    prisma.member.count({ where: { profession: { not: null } } }),
    prisma.member.count({ where: { prefEducation: { not: "" } } }),
    prisma.member.count({ where: { prefOccupation: { not: "" } } }),
    prisma.memberTag.count({
      where: { tagValue: { category: { name: { in: ["Education", "Profession"] } } } },
    }),
  ]);

  console.log("Holding a value now:");
  console.log(`  education        ${education}`);
  console.log(`  profession       ${profession}`);
  console.log(`  prefEducation    ${prefEducation}${withPrefs ? "" : "   (left alone — pass --prefs)"}`);
  console.log(`  prefOccupation   ${prefOccupation}${withPrefs ? "" : "   (left alone — pass --prefs)"}`);
  console.log(`  MemberTag rows   ${memberTags}${withTags ? "" : "   (left alone — pass --tags)"}`);

  if (!apply) {
    console.log("\nReport only. Re-run with --apply to make the change.");
    return;
  }

  // One transaction: a half-cleared state would leave the filters showing some of the old values
  // and none of the new, which is worse than either end of the change.
  const result = await prisma.$transaction(async (tx) => {
    const cleared = await tx.member.updateMany({
      where: { OR: [{ education: { not: null } }, { profession: { not: null } }] },
      data: { education: null, profession: null },
    });

    let prefs = 0;
    if (withPrefs) {
      const r = await tx.member.updateMany({
        where: { OR: [{ prefEducation: { not: "" } }, { prefOccupation: { not: "" } }] },
        data: { prefEducation: "", prefOccupation: "" },
      });
      prefs = r.count;
    }

    let tags = 0;
    if (withTags) {
      const r = await tx.memberTag.deleteMany({
        where: { tagValue: { category: { name: { in: ["Education", "Profession"] } } } },
      });
      tags = r.count;
    }

    return { cleared: cleared.count, prefs, tags };
  });

  console.log(`\nCleared education/profession on ${result.cleared} members.`);
  if (withPrefs) console.log(`Cleared preference lists on ${result.prefs} members.`);
  if (withTags) console.log(`Removed ${result.tags} MemberTag rows.`);

  const [eduLeft, profLeft] = await Promise.all([
    prisma.member.count({ where: { education: { not: null } } }),
    prisma.member.count({ where: { profession: { not: null } } }),
  ]);
  console.log(`Remaining non-null: education ${eduLeft}, profession ${profLeft}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
