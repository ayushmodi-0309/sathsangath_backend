/**
 * Sets the build number the mobile app prompts members to update to.
 *
 * The app compares its own build number (the +N in pubspec's `version: 1.1.2+10`) with `latest`
 * and shows a dismissible "Update available" card when it is lower. Nothing is ever blocked.
 * Only raise `latest` once that build is actually visible in the store.
 *
 *   npx tsx scripts/set-app-version.ts                              # show current values
 *   npx tsx scripts/set-app-version.ts android 11                   # dry run
 *   npx tsx scripts/set-app-version.ts android 11 --apply           # write it
 *   npx tsx scripts/set-app-version.ts ios 11 --apply --store-url=https://apps.apple.com/app/id123
 *   npx tsx scripts/set-app-version.ts ios 11 --apply --message="Faster feed and fixes"
 */
import { prisma } from "../src/lib/db";
import { appVersionSchema, getAppVersion, isPlatform, PLATFORMS, setAppVersion } from "../src/lib/app-version";

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const [platform, build] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  if (!platform) {
    for (const p of PLATFORMS) console.log(p.padEnd(8), JSON.stringify(await getAppVersion(p)));
    return;
  }
  if (!isPlatform(platform)) throw new Error(`platform must be one of: ${PLATFORMS.join(", ")}`);
  const latest = Number(build);
  if (!Number.isInteger(latest) || latest < 0) throw new Error("build must be a whole number, e.g. 11");

  const current = await getAppVersion(platform);
  const next = appVersionSchema.parse({
    latest,
    storeUrl: flag("store-url") ?? current.storeUrl,
    message: flag("message") ?? current.message,
  });
  console.log("current:", JSON.stringify(current));
  console.log("next:   ", JSON.stringify(next));

  if (!process.argv.includes("--apply")) return console.log("\nDry run. Pass --apply to write.");
  await setAppVersion(platform, next);
  console.log("\nSaved.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
