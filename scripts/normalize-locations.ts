/**
 * Backfills `district` and canonicalises the place of living on the rows already in the table.
 *
 * `city`, `state` and `country` were user-driven for a long time, so the columns hold a mix of
 * districts ("Mumbai Suburban"), towns ("Kadi", "Unjha", "Dhoraji"), one value that is neither
 * ("Jodhpur (Ahmedabad)"), and a couple of country names where an ISO code belongs ("Bahrain").
 * The feed filter facets are grouped straight off these columns, so every one of those spellings
 * shows up as a filter chip until it is fixed here.
 *
 * What it does, per row:
 *
 *   • India — resolves (state, city) onto the closed Country → State → District → City/Town list in
 *     src/lib/locations.ts, then writes back the canonical state, the district, and the town when
 *     the stored value really was a town. "Ahmedabad" becomes district Ahmedabad / town Ahmedabad;
 *     "Kadi" becomes district Mehsana / town Kadi; "Mumbai Suburban" becomes that district with no
 *     town, because there is no town of the name.
 *   • Not India — clears state, district and city. That is the decision: outside India we ask for
 *     the country and nothing below it. The handful of stored values ("Boston | Massachusetts")
 *     are dropped, which is why the report lists them before anything is written.
 *   • A country stored as a name rather than a code is mapped to the code.
 *   • Anything that cannot be resolved is LEFT EXACTLY AS IT IS and listed in the report. Guessing
 *     is worse than a stale value: the member or the office fixes it on the next edit, and the web
 *     pickers keep showing a stored off-list value so it stays visible until then.
 *
 * Run with:
 *   npm run locations:normalize              # report only, changes nothing
 *   npm run locations:normalize -- --apply   # write it
 *
 * Extra, opt-in:
 *   --clear-unmapped   also empty city/state on the India rows that could not be resolved
 *   --csv <path>       write the unresolved rows out for the office to fix by hand
 *
 * Take a dump first. `backups/README.md` has the restore commands.
 */

import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { ALL_COUNTRIES } from "../src/lib/countries-data";
import { INDIA, resolveLegacyCity, resolveLocation } from "../src/lib/locations";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const clearUnmapped = args.includes("--clear-unmapped");
const csvPath = args[args.indexOf("--csv") + 1];
const wantCsv = args.includes("--csv") && csvPath && !csvPath.startsWith("--");

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const COUNTRY_BY_NAME = new Map(ALL_COUNTRIES.map(([code, name]) => [fold(name), code]));
const COUNTRY_NAME = new Map(ALL_COUNTRIES.map(([code, name]) => [code, name]));

/**
 * Stored values the resolver cannot place on its own, keyed on the folded spelling.
 *
 * Only put something here that is not a guess. "Jodhpur (Ahmedabad)" names a locality inside
 * Ahmedabad, and Ahmednagar is simply what Ahilyanagar was called before 2024. A value that is
 * genuinely ambiguous — "Kalol" is a town in both Gandhinagar and Panchmahal — is left in the
 * report for the office or the member to settle, because picking one would be inventing an address.
 */
const LEGACY_CITY_OVERRIDES: Record<string, { state: string; district: string; city: string | null }> = {
  jodhpurahmedabad: { state: "Gujarat", district: "Ahmedabad", city: "Ahmedabad" },
  ahmednagar: { state: "Maharashtra", district: "Ahilyanagar", city: "Ahilyanagar" },
};

type Verdict = "ok" | "district-only" | "override" | "cleared" | "unchanged" | "unmapped";

type Patch = { country?: string; state?: string | null; district?: string | null; city?: string | null };

function decide(row: { country: string; state: string | null; district: string | null; city: string | null }): { verdict: Verdict; patch: Patch; note?: string } {
  // A country held as a name rather than a code, e.g. "Bahrain".
  const code = row.country?.length === 2 ? row.country.toUpperCase() : COUNTRY_BY_NAME.get(fold(row.country ?? "")) ?? row.country;
  const country = (code || INDIA).toUpperCase();

  if (country !== INDIA) {
    const clearing = [row.state, row.district, row.city].some(Boolean);
    if (!clearing && country === row.country) return { verdict: "unchanged", patch: {} };
    return {
      verdict: "cleared",
      patch: { country, state: null, district: null, city: null },
      note: clearing ? `drops ${[row.city, row.state].filter(Boolean).join(", ")}` : undefined,
    };
  }

  const override = row.city ? LEGACY_CITY_OVERRIDES[fold(row.city)] : undefined;
  const resolved = override ?? resolveLegacyCity(row.city, row.state);
  if (!resolved) {
    if (!row.city && !row.state) return { verdict: "unchanged", patch: country === row.country ? {} : { country } };
    return { verdict: "unmapped", patch: clearUnmapped ? { country, state: null, district: null, city: null } : {} };
  }
  const patch: Patch = { country, state: resolved.state, district: resolved.district, city: resolved.city };
  const same = patch.state === row.state && patch.district === row.district && patch.city === row.city && patch.country === row.country;
  if (same) return { verdict: "unchanged", patch: {} };
  return { verdict: override ? "override" : resolved.city ? "ok" : "district-only", patch };
}

async function main() {
  const members = await prisma.member.findMany({
    select: { id: true, profileCode: true, country: true, state: true, district: true, city: true },
    orderBy: { profileCode: "asc" },
  });

  // Group identical places together: 912 members share about 70 of them, so the report is short
  // enough to read line by line before anything is written.
  type Combo = { country: string; state: string | null; city: string | null; count: number; verdict: Verdict; to: Patch; note?: string };
  const combos = new Map<string, Combo>();
  const writes: { id: string; patch: Patch }[] = [];
  const unresolved: { profileCode: string; city: string | null; state: string | null; country: string }[] = [];

  for (const m of members) {
    const { verdict, patch, note } = decide(m);
    const key = `${m.country}|${m.state ?? ""}|${m.city ?? ""}`;
    const combo = combos.get(key) ?? { country: m.country, state: m.state, city: m.city, count: 0, verdict, to: patch, note };
    combo.count++;
    combos.set(key, combo);
    if (Object.keys(patch).length) writes.push({ id: m.id, patch });
    if (verdict === "unmapped") unresolved.push({ profileCode: m.profileCode, city: m.city, state: m.state, country: m.country });
  }

  const india = members.filter((m) => (m.country || INDIA).toUpperCase() === INDIA).length;
  console.log(`\nmembers            ${members.length}`);
  console.log(`  in India         ${india}`);
  console.log(`  elsewhere        ${members.length - india}`);
  console.log(`  holding a city   ${members.filter((m) => m.city?.trim()).length}`);
  console.log(`  holding a state  ${members.filter((m) => m.state?.trim()).length}`);

  const LABEL: Record<Verdict, string> = {
    ok: "OK           ", "district-only": "DISTRICT-ONLY", override: "OVERRIDE     ",
    cleared: "CLEARED      ", unchanged: "unchanged    ", unmapped: "UNMAPPED     ",
  };
  console.log(`\n${combos.size} distinct place(s) stored:\n`);
  const ordered = [...combos.values()].sort((a, b) => b.count - a.count);
  for (const c of ordered) {
    const from = [c.city, c.state, COUNTRY_NAME.get(c.country) ?? c.country].filter(Boolean).join(", ");
    const to = c.verdict === "unchanged" ? "—"
      : c.verdict === "unmapped" ? (clearUnmapped ? "cleared (--clear-unmapped)" : "left as it is")
      : c.verdict === "cleared" ? `${COUNTRY_NAME.get(c.to.country ?? "") ?? c.to.country}, nothing below${c.note ? ` — ${c.note}` : ""}`
      : [c.to.city, c.to.district && `${c.to.district} district`, c.to.state].filter(Boolean).join(", ");
    console.log(`  ${LABEL[c.verdict]}  ${String(c.count).padStart(3)}  ${from.padEnd(42)} → ${to}`);
  }

  const counts = ordered.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.verdict]: (acc[c.verdict] ?? 0) + c.count }), {});
  console.log(`\nrows to change     ${writes.length}`);
  for (const [verdict, n] of Object.entries(counts)) console.log(`  ${verdict.padEnd(15)}${n}`);

  if (unresolved.length) {
    console.log(`\n${unresolved.length} member(s) could not be resolved${clearUnmapped ? " and will be cleared" : " and are left untouched"}:`);
    for (const u of unresolved.slice(0, 20)) console.log(`  ${u.profileCode}  ${[u.city, u.state, u.country].filter(Boolean).join(" | ")}`);
    if (unresolved.length > 20) console.log(`  … and ${unresolved.length - 20} more`);
    if (wantCsv) {
      const rows = ["profileCode,city,state,country", ...unresolved.map((u) => [u.profileCode, u.city ?? "", u.state ?? "", u.country].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))];
      writeFileSync(csvPath, rows.join("\n") + "\n");
      console.log(`  written to ${csvPath}`);
    }
  }

  // The same gate the API uses, over the values this script is about to write: if any of them would
  // be refused on a member's own edit, the mapping above is wrong and nothing should be written.
  const bad = writes.filter((w) => {
    const r = resolveLocation({ country: w.patch.country, state: w.patch.state, district: w.patch.district, city: w.patch.city });
    return !r.ok || r.value.district !== (w.patch.district ?? null) || r.value.city !== (w.patch.city ?? null);
  });
  if (bad.length) {
    console.error(`\nFAIL: ${bad.length} row(s) would be written in a shape the API would refuse. Nothing written.`);
    console.error(JSON.stringify(bad.slice(0, 5), null, 2));
    process.exit(1);
  }

  if (!apply) {
    console.log("\nReport only. Re-run with --apply to write it.\n");
    return;
  }

  let done = 0;
  // One statement per distinct patch rather than per row would be fewer round trips, but the rows
  // are few and a per-row update keeps the script readable and restartable.
  for (const w of writes) {
    await prisma.member.update({ where: { id: w.id }, data: w.patch });
    done++;
  }
  console.log(`\nupdated ${done} member(s).`);
  console.log("Re-run without --apply: it should report 0 rows to change.\n");
}

main().finally(() => prisma.$disconnect());
