/**
 * Generates the India state → district → city/town tables that `src/lib/locations.ts` and the
 * web's `lib/locations.ts` read, and writes the same module into both projects.
 *
 *   npm run locations:generate            # build from the cache, download anything missing
 *   npm run locations:generate -- --refresh   # re-download the sources
 *   npm run locations:generate -- --stats     # counts only, write nothing
 *   npm run locations:generate -- --verify    # fail if the checked-in files differ from a fresh build
 *
 * Two sources, because neither is enough on its own:
 *
 *   • Districts come from dr5hn/countries-states-cities-database (`csv/counties.csv`, the rows with
 *     `country_code=IN`). 783 of them, each tied to a state, in the spelling people use today
 *     (Mehsana, Bengaluru Urban, Dharashiv). States come from the same release, so the state
 *     codes and the district rows cannot disagree — note dr5hn calls Uttarakhand UK where the
 *     `country-state-city` package this repo also depends on calls it UT.
 *
 *   • Towns come from GeoNames (`IN.zip` + `admin2Codes.txt`). dr5hn also ships Indian cities, but
 *     only ~25% carry a district link and *none* of the towns our own members live in do (checked:
 *     Ahmedabad, Kadi, Unjha, Dhoraji, Nadiad, Viramgam all have a null `county_id`). GeoNames
 *     fills `admin2` for 555k places, and spot checks are right: Kadi → Mehsana, Navi Mumbai →
 *     Thane, Bengaluru → Bangalore Urban.
 *
 * Joining the two means reconciling GeoNames' older, diacritic-heavy district names against
 * dr5hn's current ones. Folding accents and punctuation gets 603/763; also stripping the word
 * "district" and trading the Hindi direction words for English ones gets 659. The rest are genuine
 * renames and are listed in DISTRICT_ALIASES below, one line each, so the next data refresh can be
 * reviewed rather than re-derived. Anything unmatched and unlisted aborts the run — a silent drop
 * would quietly lose every town in that district.
 *
 * Both sources are CC-BY 4.0. The attribution is a licence condition: see LEGAL.md on the web and
 * the header of the generated files.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ALL_COUNTRIES } from "../src/lib/countries-data";

// ── Sources ───────────────────────────────────────────────────────────────────

const DR5HN_REF = "master";
const SOURCES = {
  "counties.csv": `https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/${DR5HN_REF}/csv/counties.csv`,
  "states.csv": `https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/${DR5HN_REF}/csv/states.csv`,
  "admin2Codes.txt": "https://download.geonames.org/export/dump/admin2Codes.txt",
  "admin1CodesASCII.txt": "https://download.geonames.org/export/dump/admin1CodesASCII.txt",
  "IN.zip": "https://download.geonames.org/export/dump/IN.zip",
} as const;

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const CACHE = join(ROOT, ".cache", "geo");
const OUT_BACKEND = join(ROOT, "src", "lib", "india-locations-data.ts");
const OUT_FRONTEND = join(ROOT, "..", "sathsangath_frontend", "lib", "india-locations-data.ts");
/**
 * The mobile app ships the same data as a bundled asset and refreshes it from `GET
 * /public/locations`. Bundling it is what keeps the location step usable on a first run with no
 * network — the step is required, and an empty state list would be a dead end — while the fetch is
 * what lets a renamed district reach people without a store release.
 */
const OUT_APP_ASSET = join(ROOT, "..", "sathsangath_app", "assets", "geo", "india-locations.json");

const args = new Set(process.argv.slice(2));
const flag = (name: string) => args.has(`--${name}`);

function source(name: keyof typeof SOURCES): string {
  const path = join(CACHE, name);
  if (!existsSync(path) || flag("refresh")) {
    mkdirSync(CACHE, { recursive: true });
    console.log(`  fetching ${name} …`);
    execFileSync("curl", ["-sSfL", "-A", "curl", "-o", path, SOURCES[name]], { stdio: "inherit" });
  }
  return path;
}

/** GeoNames ships country dumps as zips only; `unzip` is present on macOS and on the CI images. */
function geonamesPlaces(): string {
  const txt = join(CACHE, "IN.txt");
  if (!existsSync(txt) || flag("refresh")) {
    execFileSync("unzip", ["-o", "-q", source("IN.zip"), "IN.txt", "-d", CACHE], { stdio: "inherit" });
  }
  return readFileSync(txt, "utf8");
}

const tsv = (body: string) => body.split("\n").filter(Boolean).map((l) => l.split("\t"));

/** Minimal CSV reader: enough for dr5hn's quoted-comma rows, no escapes beyond doubled quotes. */
function csv(body: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"') { if (body[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() ?? [];
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// ── Name folding ──────────────────────────────────────────────────────────────

/** "Mahesāna" → "Mahesana". The stored and displayed spelling is always the ASCII one. */
export const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** A comparison key: accents, punctuation, case and the noise words all gone. */
const fold = (s: string) =>
  ascii(s).toLowerCase().replace(/&/g, " and ").replace(/\b(district|dist|division)\b/g, " ").replace(/^\s*the\b/, " ").replace(/[^a-z0-9]/g, "");

const HINDI_DIRECTION: Record<string, string> = {
  uttar: "north", uttara: "north", dakshin: "south", dakshina: "south",
  purba: "east", purbi: "east", poorbi: "east", pashchim: "west", paschim: "west", pashchimi: "west",
};
const ENGLISH_DIRECTION: Record<string, string[]> = {
  north: ["uttar", "uttara"], south: ["dakshin", "dakshina"], east: ["purba", "purbi"], west: ["pashchim", "paschim"],
};

/** Every spelling of a district name worth trying: "Purbi Singhbhum" has to reach "East Singhbum". */
function variants(name: string): string[] {
  const out = new Set([fold(name)]);
  const words = ascii(name).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !["district", "dist", "division", "the"].includes(w));
  if (words.length) {
    const first = words[0], last = words[words.length - 1];
    if (HINDI_DIRECTION[first]) out.add(fold([HINDI_DIRECTION[first], ...words.slice(1)].join(" ")));
    if (words.length > 1 && HINDI_DIRECTION[last]) out.add(fold([HINDI_DIRECTION[last], ...words.slice(0, -1)].join(" ")));
    for (const hindi of ENGLISH_DIRECTION[first] ?? []) out.add(fold([hindi, ...words.slice(1)].join(" ")));
    if (words.length > 1) out.add(fold([...words.slice(1), first].join(" ")));
  }
  return [...out];
}

/**
 * GeoNames district name → the dr5hn district it is, keyed "<stateIso>|<geonames name>".
 *
 * Mostly renames (Mysore → Mysuru, Osmanabad → Dharashiv, Aurangabad → Chhatrapati Sambhajinagar),
 * transliterations (Kutch → Kachchh, Hugli → Hooghly), and dr5hn's own quirks (Odisha in Odia
 * spelling; "East Singhbum" missing an h). Each was checked against the nearest district by
 * centroid and the district's largest town.
 */
const DISTRICT_ALIASES: Record<string, string> = {
  // Andaman & Nicobar
  "AN|Nicobar": "Nicobars", "AN|North  & Middle Andaman": "North And Middle Andaman", "AN|South Andaman": "South Andamans",
  // Andhra Pradesh
  "AP|Nellore": "Sri Potti Sriramulu Nellore", "AP|YSR district": "Y.S.R. Kadapa",
  "AP|Anantapur": "Ananthapuramu", "AP|Konaseema": "Dr. B.R. Ambedkar Konaseema",
  // Assam
  "AS|Morigaon": "Marigaon", "AS|Sibsāgar": "Sivasagar", "AS|Karimganj": "Sribhumi", "AS|Kamrup Metropolitan": "Kamrup Metro",
  // Delhi — GeoNames suffixes every zone with "Delhi"; Shahdara was carved out of East.
  "DL|North West Delhi": "North West", "DL|North Delhi": "North", "DL|North East Delhi": "North East",
  "DL|East Delhi": "East", "DL|Central Delhi": "Central", "DL|West Delhi": "West",
  "DL|South West Delhi": "South West", "DL|South Delhi": "South", "DL|Shahdara": "East",
  // Gujarat
  "GJ|Kutch": "Kachchh", "GJ|Ahmadābād": "Ahmedabad", "GJ|Dohad": "Dahod",
  // Haryana / Himachal
  "HR|Charki Dadri": "Charkhi Dadri", "HP|Lāhul and Spiti": "Lahaul And Spiti", "HP|Kulu": "Kullu",
  // Jammu & Kashmir, Ladakh
  "JK|Badgam": "Budgam", "JK|Punch": "Poonch", "JK|Rājauri": "Rajouri", "JK|Bāramūla": "Baramulla",
  "JK|Bandipore": "Bandipora", "JK|Shupiyan": "Shopian", "LA|Leh": "Leh Ladakh",
  // Kerala
  "KL|Pattanamtitta": "Pathanamthitta",
  // Maharashtra
  "MH|Gondiya": "Gondia", "MH|Aurangabad": "Chhatrapati Sambhajinagar", "MH|Raigarh": "Raigad",
  "MH|Ahmadnagar": "Ahilyanagar", "MH|Bid": "Beed", "MH|Osmanabad": "Dharashiv",
  // Karnataka — the 2014 and 2024 renamings
  "KA|Belgaum": "Belagavi", "KA|Bagalkot": "Bagalkote", "KA|Bijapur": "Vijayapura", "KA|Shimoga": "Shivamogga",
  "KA|Chikmagalur": "Chikkamagaluru", "KA|Tumkur": "Tumakuru", "KA|Bangalore Urban": "Bengaluru Urban",
  "KA|Mysore": "Mysuru", "KA|Chamrajnagar": "Chamarajanagar", "KA|Gulbarga": "Kalaburagi",
  "KA|Chikkaballapur": "Chikkaballapura", "KA|Bangalore Rural": "Bengaluru Rural",
  "KA|Ramanagara": "Bengaluru South", "KA|Vijayanagar": "Vijayanagara",
  // Odisha — dr5hn carries the Odia spellings
  "OR|Baragarh": "Baragada", "OR|Debagarh": "Debagada", "OR|Sundargarh": "Sundaragada",
  "OR|Kendrapara": "Kendrapada", "OR|Jagatsinghpur": "Jagatsinghapur", "OR|Cuttack": "Kataka",
  "OR|Angul District": "Anugola", "OR|Nayagarh District": "Nayagada", "OR|Kandhamal": "Kandhamala", "OR|Baudh": "Boudh",
  // Punjab / Rajasthan
  "PB|Firozpur": "Ferozepur", "PB|Muktsar": "Sri Muktsar Sahib", "PB|Ajitgarh": "S.A.S Nagar",
  "RJ|Dhaulpur": "Dholpur", "RJ|Chittaurgarh": "Chittorgarh",
  // Tamil Nadu — Tirunelveli Kattabomman predates the 2019 Tenkasi split; its towns span both.
  "TN|Villupuram": "Viluppuram", "TN|Tirunelveli Kattabo": "Tirunelveli", "TN|Tirupattur district": "Tirupathur",
  // West Bengal / Mizoram / Bihar
  "WB|Hugli": "Hooghly", "WB|Puruliya": "Purulia", "WB|Hāora": "Howrah", "MZ|Saiha": "Siaha",
  "BR|Kaimur District": "Kaimur (Bhabua)",
  // Madhya Pradesh
  "MP|Khargone": "Khargone (West Nimar)", "MP|Khandwa district": "Khandwa (East Nimar)",
  // Uttar Pradesh / Uttarakhand
  "UP|Shājahānpur": "Shahjahanpur", "UP|Ferrukhabad": "Farrukhabad", "UP|Kānpur": "Kanpur Nagar",
  "UP|Maharajganj": "Mahrajganj", "UK|Garhwāl": "Pauri Garhwal",
  // Chhattisgarh — the new composite districts
  "CT|Koriya": "Korea", "CT|Baloda Bazar": "Balodabazar-Bhatapara", "CT|Balrampur": "Balrampur-Ramanujganj",
  "CT|Gaurella Pendra Marwahi": "Gaurela-Pendra-Marwahi",
  "CT|Khairgarh Chhuikhadan Gandai": "Khairagarh-Chhuikhadan-Gandai",
  "CT|Manendragarh Chirimiri Bharatpur": "Manendragarh-Chirmiri-Bharatpur(M C B)",
  // Jharkhand — "East Singhbum" is dr5hn's spelling, missing an h
  "JH|Kodarma": "Koderma", "JH|Deogarh": "Deoghar", "JH|Sahibganj": "Sahebganj",
  "JH|Purbi Singhbhum": "East Singhbum", "JH|Hazārībāg": "Hazaribagh", "JH|Saraikela": "Saraikela Kharsawan",
  // Telangana
  "TG|Rangareddi": "Ranga Reddy", "TG|Mahbūbnagar": "Mahabubnagar", "TG|Warangal Rural": "Warangal",
  "TG|Hanamkonda": "Hanumakonda",
};

/** GeoNames districts dr5hn simply does not carry. Both are uninhabited in the dump — 0 places. */
const DISTRICTS_IGNORED = new Set(["PY|Yanam", "PY|Mahe"]);

/** Both tables above are keyed on the folded name, so "Bijāpur" and "Bijapur" are the same key. */
const aliasKey = (state: string, name: string) => `${state}|${fold(name)}`;
const ALIASES = new Map(Object.entries(DISTRICT_ALIASES).map(([k, v]) => {
  const [state, name] = k.split("|");
  return [aliasKey(state, name), v];
}));
const IGNORED = new Set([...DISTRICTS_IGNORED].map((k) => {
  const [state, name] = k.split("|");
  return aliasKey(state, name);
}));

/**
 * Places GeoNames gives no district at all. Three of them are large enough to matter, and a
 * generated file that lost Mumbai would be worse than no file.
 */
const TOWN_DISTRICT_OVERRIDES: Record<string, string> = {
  "MH|Mumbai": "Mumbai City", "DL|Delhi": "New Delhi", "RJ|Nimach": "Neem ka Thana",
};

/**
 * Display spellings, applied to districts and towns alike.
 *
 * dr5hn and GeoNames carry a few names in a spelling no one here writes — the Gujarat ones matter
 * most, since that is where most of our families live. Extend this table rather than correcting the
 * generated file, which is overwritten on every run.
 */
const SPELLING: Record<string, string> = {
  // Gujarat, to the state government's own spellings
  Mahesana: "Mehsana", "Banas Kantha": "Banaskantha", "Sabar Kantha": "Sabarkantha",
  "Panch Mahals": "Panchmahal", Chhotaudepur: "Chhota Udaipur", Arvalli: "Aravalli", Dangs: "Dang",
  Morvi: "Morbi",
  // dr5hn shouts this one
  MAUGANJ: "Mauganj",
};

/**
 * Spellings for districts only.
 *
 * Mumbai is two districts, Mumbai City and Mumbai Suburban, and dr5hn calls the first one plain
 * "Mumbai" — which reads as a third option beside the other two. The *town* is still Mumbai, so
 * this cannot go in SPELLING above, which applies to both.
 */
const DISTRICT_SPELLING: Record<string, string> = { Mumbai: "Mumbai City" };
/** Keyed on the folded name, so "Mahesāna", "Mahesana" and "The Dāngs" all find their entry. */
const RESPELL = new Map(Object.entries(SPELLING).map(([from, to]) => [fold(from), to]));
const RESPELL_DISTRICT = new Map(Object.entries(DISTRICT_SPELLING).map(([from, to]) => [fold(from), to]));
const respell = (name: string) => RESPELL.get(fold(name)) ?? name;
const respellDistrict = (name: string) => RESPELL_DISTRICT.get(fold(name)) ?? respell(name);

/** `admin2` values that name a division rather than a district; each has a district of the name. */
const DIVISION_SUFFIX = /\s+Division$/;

// ── Build ─────────────────────────────────────────────────────────────────────

type Town = { name: string; population: number };

function build() {
  // States come from dr5hn rather than the `country-state-city` package, even though the package is
  // already a dependency: the two disagree on Uttarakhand (dr5hn says UK, the package says UT), and
  // the code is only ever a join key against counties.csv. The stored value is always the name.
  const states = csv(readFileSync(source("states.csv"), "utf8"))
    .filter((r) => r.country_code === "IN")
    .map((r) => ({ code: r.iso2, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const stateByFoldedName = new Map(states.map((s) => [fold(s.name), s.code]));

  // Districts: dr5hn.
  const districts = csv(readFileSync(source("counties.csv"), "utf8"))
    .filter((r) => r.country_code === "IN")
    .map((r) => ({ state: r.state_code, name: respellDistrict(r.name) }))
    .sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  const districtIndex = new Map<string, string>();           // "GJ|<folded>" -> canonical name
  for (const d of districts) for (const v of variants(d.name)) districtIndex.set(`${d.state}|${v}`, d.name);
  const known = new Set(districts.map((d) => `${d.state}|${d.name}`));

  // GeoNames admin1 (numeric) -> state ISO, admin2 -> district name.
  const geoState = new Map<string, string>();
  for (const p of tsv(readFileSync(source("admin1CodesASCII.txt"), "utf8"))) {
    if (!p[0].startsWith("IN.")) continue;
    const iso = stateByFoldedName.get(fold(p[1]));
    if (iso) geoState.set(p[0].slice(3), iso);
  }
  const geoDistrict = new Map<string, string>();
  for (const p of tsv(readFileSync(source("admin2Codes.txt"), "utf8"))) {
    if (p[0].startsWith("IN.")) geoDistrict.set(p[0].slice(3), p[1]);
  }

  /** Resolve one GeoNames admin2 code onto a dr5hn district, or null when it is deliberately dropped. */
  const resolveCache = new Map<string, string | null>();
  const unresolved = new Map<string, { state: string; name: string; towns: number; maxPop: number }>();
  function districtFor(admin1: string, admin2: string): string | null {
    const key = `${admin1}.${admin2}`;
    if (resolveCache.has(key)) return resolveCache.get(key)!;
    const state = geoState.get(admin1);
    const raw = geoDistrict.get(key);
    let hit: string | null = null;
    if (state && raw) {
      const alias = ALIASES.get(aliasKey(state, raw));
      const candidates = (alias ? [alias, raw.replace(DIVISION_SUFFIX, "")] : [raw, raw.replace(DIVISION_SUFFIX, "")]).map(respellDistrict);
      for (const c of candidates) {
        if (known.has(`${state}|${c}`)) { hit = c; break; }
        const found = variants(c).map((v) => districtIndex.get(`${state}|${v}`)).find(Boolean);
        if (found) { hit = found; break; }
      }
      if (!hit && !IGNORED.has(aliasKey(state, raw))) {
        unresolved.set(`${state}|${raw}`, { state, name: raw, towns: 0, maxPop: 0 });
      }
    }
    resolveCache.set(key, hit);
    return hit;
  }

  // Towns: GeoNames populated places.
  /**
   * Feature codes that are not somewhere anyone lives now: abandoned, destroyed, historical. Every
   * other populated place is kept and left to the population bar below, which is the filter that
   * actually works — an allow-list of "proper" codes quietly dropped Navi Mumbai, a city of 2.6
   * million that GeoNames files as PPLX, "a section of a populated place".
   */
  const GONE = new Set(["PPLQ", "PPLW", "PPLH"]);
  const SEAT = new Set(["PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG"]);
  const districtNames = new Set(districts.map((d) => fold(d.name)));
  const towns = new Map<string, Map<string, Town>>();        // "GJ|Mehsana" -> folded town -> town
  let skippedNoDistrict = 0;
  const bigWithoutDistrict: string[] = [];

  for (const p of tsv(geonamesPlaces())) {
    if (p[6] !== "P" || GONE.has(p[7])) continue;
    const name = respell(ascii(p[1]).trim());
    // A handful of GeoNames rows hold a comma-separated list of localities rather than one name.
    if (name.includes(",")) continue;
    const population = Number(p[14] || 0);
    const state = geoState.get(p[10]);
    if (!name || !state) continue;

    let district = p[11] ? districtFor(p[10], p[11]) : null;
    if (!district) district = TOWN_DISTRICT_OVERRIDES[`${state}|${name}`] ?? null;
    if (!district) {
      skippedNoDistrict++;
      if (population >= 100_000) bigWithoutDistrict.push(`${name} (${state}, pop ${population.toLocaleString()})`);
      continue;
    }
    const key = `${state}|${district}`;
    // Worth offering: a real town, an administrative seat, or the district's own namesake.
    if (!(population >= 5000 || SEAT.has(p[7]) || districtNames.has(fold(name)))) continue;

    const bucket = towns.get(key) ?? new Map<string, Town>();
    const folded = fold(name);
    const existing = bucket.get(folded);
    // The same name can appear several times in one district; keep the most populous spelling.
    if (!existing || existing.population < population) bucket.set(folded, { name, population });
    towns.set(key, bucket);
  }

  for (const [key, info] of unresolved) {
    const bucket = towns.get(key);
    info.towns = bucket?.size ?? 0;
  }
  return { states, districts, towns, unresolved, skippedNoDistrict, bigWithoutDistrict };
}

// ── Emit ──────────────────────────────────────────────────────────────────────

function render(b: ReturnType<typeof build>): string {
  const lit = (s: string) => JSON.stringify(s);
  const stateRows = b.states.map((s) => `[${lit(s.code)},${lit(s.name)}]`).join(",");
  const districtRows = b.districts.map((d) => `[${lit(d.state)},${lit(d.name)}]`).join(",");
  const townRows = [...b.towns.entries()]
    .sort(([a], [c]) => a.localeCompare(c))
    .map(([key, bucket]) => {
      const names = [...bucket.values()].sort((x, y) => x.name.localeCompare(y.name)).map((t) => lit(t.name));
      return `${lit(key)}:[${names.join(",")}]`;
    })
    .join(",");

  const version = new Date().toISOString().slice(0, 10);
  return `/**
 * GENERATED by sathsangath_backend/scripts/generate-india-locations.ts — do not edit by hand.
 * Run \`npm run locations:generate\` in sathsangath_backend to rebuild both copies of this file.
 *
 * India's states/UTs, their districts, and the towns inside each district.
 *
 * Data: districts from the Countries States Cities Database (dr5hn), CC BY 4.0;
 * towns from GeoNames (https://www.geonames.org), CC BY 4.0. Both are credited in LEGAL.md.
 *
 * ${b.states.length} states/UTs · ${b.districts.length} districts · ${[...b.towns.values()].reduce((n, m) => n + m.size, 0)} towns
 */

/** \`[isoCode, name]\` — the ISO code is the join key below, the name is what gets stored. */
export const INDIA_STATES: readonly (readonly [code: string, name: string])[] = [${stateRows}];

/** \`[stateCode, districtName]\`, sorted by state then district. */
export const INDIA_DISTRICTS: readonly (readonly [stateCode: string, name: string])[] = [${districtRows}];

/** Towns, keyed \`"<stateCode>|<districtName>"\`. A district with no listed town is absent. */
export const INDIA_TOWNS: Readonly<Record<string, readonly string[]>> = {${townRows}};

/** Bumped on every regeneration; clients cache against it. */
export const INDIA_LOCATIONS_VERSION = ${lit(version)};
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const b = build();
const townCount = [...b.towns.values()].reduce((n, m) => n + m.size, 0);
const districtsWithTowns = b.towns.size;

console.log(`\nstates/UTs          ${b.states.length}`);
console.log(`districts           ${b.districts.length}  (${districtsWithTowns} have at least one town)`);
console.log(`towns               ${townCount}`);
console.log(`places with no district ${b.skippedNoDistrict}`);

if (b.unresolved.size) {
  console.error(`\nFAIL: ${b.unresolved.size} GeoNames district(s) do not match any dr5hn district:`);
  for (const [key, i] of b.unresolved) console.error(`  ${key}  (${i.towns} towns)`);
  console.error("Add each to DISTRICT_ALIASES (or DISTRICTS_IGNORED if it really has no towns).");
  process.exit(1);
}

if (b.bigWithoutDistrict.length) {
  console.error(`\nFAIL: ${b.bigWithoutDistrict.length} place(s) over 100k have no district:`);
  for (const p of b.bigWithoutDistrict) console.error(`  ${p}`);
  console.error("Add each to TOWN_DISTRICT_OVERRIDES.");
  process.exit(1);
}

const out = render(b);
if (flag("stats")) process.exit(0);

if (flag("verify")) {
  let bad = false;
  for (const path of [OUT_BACKEND, OUT_FRONTEND]) {
    const have = existsSync(path) ? readFileSync(path, "utf8") : "";
    // The version line is a timestamp; compare everything else.
    const strip = (s: string) => s.replace(/export const INDIA_LOCATIONS_VERSION = .*/, "");
    if (strip(have) !== strip(out)) { console.error(`differs from a fresh build: ${path}`); bad = true; }
  }
  if (bad) process.exit(1);
  console.log("\nboth copies match a fresh build.");
  process.exit(0);
}

for (const path of [OUT_BACKEND, OUT_FRONTEND]) {
  writeFileSync(path, out);
  console.log(`wrote ${path}  (${(out.length / 1024).toFixed(0)} KB, sha ${createHash("sha256").update(out).digest("hex").slice(0, 12)})`);
}

// The app's asset, in exactly the shape `GET /public/locations?full=1` returns, so one parser reads
// both and a stale bundle is replaced by the response without a second code path.
const asset = JSON.stringify({
  version: out.match(/INDIA_LOCATIONS_VERSION = "([^"]+)"/)?.[1] ?? "",
  countries: ALL_COUNTRIES.map(([code, name]) => ({ code, name })),
  india: b.states.map((s) => ({
    code: s.code,
    name: s.name,
    districts: b.districts
      .filter((d) => d.state === s.code)
      .map((d) => ({
        district: d.name,
        towns: [...(b.towns.get(`${s.code}|${d.name}`)?.values() ?? [])]
          .map((t) => t.name)
          .sort((x, y) => x.localeCompare(y)),
      })),
  })),
});
mkdirSync(dirname(OUT_APP_ASSET), { recursive: true });
writeFileSync(OUT_APP_ASSET, asset);
console.log(`wrote ${OUT_APP_ASSET}  (${(asset.length / 1024).toFixed(0)} KB)`);
