/**
 * Where a member lives: country, and for India state → district → city/town.
 *
 * A mirror of `sathsangath_frontend/lib/locations.ts` — the two live in separate repositories, so
 * this is duplicated rather than imported, exactly as `education.ts` is. Both read the generated
 * `india-locations-data.ts`, which `scripts/generate-india-locations.ts` writes into both repos.
 *
 * The shape, and why:
 *
 *   • `country` is an ISO code, as before. Every one of the 250 in `countries-data.ts` is allowed.
 *   • `state` and `district` are stored as names ("Gujarat", "Mehsana"), not codes, because that is
 *     what the columns already hold and what every display path prints. The ISO state code is only
 *     a join key inside the generated data.
 *   • `city` keeps its old meaning — the town, which may be smaller than the district. It stays
 *     optional: plenty of villages are in no list, and a member in one still has a district.
 *   • Outside India we ask for nothing below the country, so state/district/city are cleared.
 *
 * `resolveLocation` is the single gate every write path goes through, so the four of them cannot
 * drift. `resolveLegacyCity` is the compatibility path: shipped app builds and the Google-Form
 * webhook send a free-typed city and no district, and the migration script has the same job to do
 * for rows already in the table.
 */

import { INDIA_DISTRICTS, INDIA_LOCATIONS_VERSION, INDIA_STATES, INDIA_TOWNS } from "./india-locations-data";

export { INDIA_LOCATIONS_VERSION };

export const INDIA = "IN";

/** Letters and digits only, so an accent, a dot or a double space cannot stand between two spellings. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (s?: string | null) => (s ?? "").trim().replace(/\s+/g, " ");

// ── The lists, as the pickers want them ───────────────────────────────────────

export type IndiaState = { code: string; name: string };

export const INDIA_STATE_LIST: IndiaState[] = INDIA_STATES.map(([code, name]) => ({ code, name }));

const STATE_BY_CODE = new Map(INDIA_STATE_LIST.map((s) => [s.code, s]));
const STATE_BY_NAME = new Map(INDIA_STATE_LIST.map((s) => [fold(s.name), s]));

/** Accepts a name ("Gujarat") or an ISO code ("GJ"); returns null for anything else. */
export function stateEntry(value?: string | null): IndiaState | null {
  const raw = clean(value);
  if (!raw) return null;
  return STATE_BY_NAME.get(fold(raw)) ?? STATE_BY_CODE.get(raw.toUpperCase()) ?? null;
}

const DISTRICTS_BY_STATE = new Map<string, string[]>();
for (const [code, name] of INDIA_DISTRICTS) {
  const list = DISTRICTS_BY_STATE.get(code) ?? [];
  list.push(name);
  DISTRICTS_BY_STATE.set(code, list);
}

/** Every district of a state, alphabetically. Takes a state name or code. */
export function districtsOf(state?: string | null): string[] {
  const s = stateEntry(state);
  return s ? [...(DISTRICTS_BY_STATE.get(s.code) ?? [])] : [];
}

/** Every district in India, so a picker can offer them grouped by state before a state is chosen. */
export const INDIA_DISTRICT_LIST: { state: string; stateCode: string; district: string }[] =
  INDIA_DISTRICTS.map(([code, district]) => ({ state: STATE_BY_CODE.get(code)?.name ?? code, stateCode: code, district }));

/** The towns of one district. Empty for a district GeoNames lists nothing in — 35 of the 783. */
export function townsOf(state?: string | null, district?: string | null): string[] {
  const s = stateEntry(state);
  const d = s ? districtEntryIn(s.code, district) : null;
  return s && d ? [...(INDIA_TOWNS[`${s.code}|${d}`] ?? [])] : [];
}

// ── Lookups ───────────────────────────────────────────────────────────────────

/** The canonical district name within one state, or null when it does not belong to it. */
function districtEntryIn(stateCode: string, district?: string | null): string | null {
  const needle = fold(clean(district));
  if (!needle) return null;
  return (DISTRICTS_BY_STATE.get(stateCode) ?? []).find((d) => fold(d) === needle) ?? null;
}

const DISTRICT_INDEX = new Map<string, { state: string; stateCode: string; district: string }[]>();
for (const row of INDIA_DISTRICT_LIST) {
  const key = fold(row.district);
  DISTRICT_INDEX.set(key, [...(DISTRICT_INDEX.get(key) ?? []), row]);
}

/**
 * Every district of that name. More than one is normal — Aurangabad is in Maharashtra and Bihar,
 * Hamirpur in Himachal and UP, Balrampur in UP and Chhattisgarh — so the caller must disambiguate
 * by state rather than take the first.
 */
export function districtEntries(district?: string | null): { state: string; stateCode: string; district: string }[] {
  return DISTRICT_INDEX.get(fold(clean(district))) ?? [];
}

const TOWN_INDEX = new Map<string, { state: string; stateCode: string; district: string; town: string }[]>();
for (const [key, towns] of Object.entries(INDIA_TOWNS)) {
  const [stateCode, district] = key.split("|");
  const state = STATE_BY_CODE.get(stateCode)?.name ?? stateCode;
  for (const town of towns) {
    const k = fold(town);
    TOWN_INDEX.set(k, [...(TOWN_INDEX.get(k) ?? []), { state, stateCode, district, town }]);
  }
}

/** Every town of that name, across India. "Jaipur" has about thirty. */
export function townEntries(town?: string | null) {
  return TOWN_INDEX.get(fold(clean(town))) ?? [];
}

/** The canonical spelling of a town inside one district, or null when it is not listed there. */
function townEntryIn(stateCode: string, district: string, town?: string | null): string | null {
  const needle = fold(clean(town));
  if (!needle) return null;
  return (INDIA_TOWNS[`${stateCode}|${district}`] ?? []).find((t) => fold(t) === needle) ?? null;
}

// ── Resolution ────────────────────────────────────────────────────────────────

export type Location = { country: string; state: string | null; district: string | null; city: string | null };

export type LocationInput = {
  country?: string | null;
  state?: string | null;
  district?: string | null;
  city?: string | null;
};

export type LocationResult =
  | { ok: true; value: Location }
  | { ok: false; field: "country" | "state" | "district"; message: string };

/**
 * The one gate. Every write path — intake, member self-edit, admin create and admin edit — passes
 * through here, so a value that reaches the column is always one the pickers offer.
 *
 * `requireDistrict` is false for the compatibility paths: an older app build has no district field
 * to send, and rejecting it would stop those members saving at all. An off-list town is dropped to
 * null rather than rejected for the same reason — storing it as typed is what filled the filter
 * facets with near-duplicates when education was free text (see `closed-lists.ts`).
 */
export function resolveLocation(input: LocationInput, opts: { requireDistrict?: boolean } = {}): LocationResult {
  const country = clean(input.country).toUpperCase() || INDIA;

  // Outside India we collect nothing below the country, and clear whatever was there before.
  if (country !== INDIA) return { ok: true, value: { country, state: null, district: null, city: null } };

  const stateGiven = clean(input.state);
  const state = stateEntry(stateGiven);
  const districtGiven = clean(input.district);

  // A state that was named but is not one is refused outright. This has to come before the
  // district branch below: inferring the state from the district would quietly accept the typo.
  if (stateGiven && !state) {
    return { ok: false, field: "state", message: `${stateGiven} is not an Indian state or union territory.` };
  }

  // A district on its own is enough to find the state, which is what the migration and the older
  // clients rely on; two states sharing a district name is the only case that needs the state.
  if (!state && districtGiven) {
    const hits = districtEntries(districtGiven);
    if (hits.length === 1) {
      const hit = hits[0];
      return { ok: true, value: { country, state: hit.state, district: hit.district, city: townEntryIn(hit.stateCode, hit.district, input.city) } };
    }
    if (hits.length > 1) return { ok: false, field: "state", message: `More than one state has a district called ${districtGiven} — choose the state.` };
  }

  if (!state) {
    return opts.requireDistrict
      ? { ok: false, field: "state", message: "Choose a state." }
      : { ok: true, value: { country, state: null, district: null, city: null } };
  }

  const district = districtEntryIn(state.code, districtGiven);
  if (districtGiven && !district) {
    return { ok: false, field: "district", message: `${districtGiven} is not a district of ${state.name}.` };
  }
  if (!district) {
    if (opts.requireDistrict) return { ok: false, field: "district", message: `Choose a district in ${state.name}.` };
    return { ok: true, value: { country, state: state.name, district: null, city: null } };
  }

  return { ok: true, value: { country, state: state.name, district, city: townEntryIn(state.code, district, input.city) } };
}

/**
 * Stored values from before this list existed, and whatever an older app build sends: one
 * free-typed city, sometimes with a state beside it.
 *
 * A town wins over a district of the same name only when nothing else fits, because the stored
 * value is far more often the district itself ("Ahmedabad", "Mumbai Suburban") than a village that
 * happens to share the name. Ambiguity is resolved by the state when there is one, and otherwise
 * reported as null rather than guessed — the migration script lists those for a human.
 */
export function resolveLegacyCity(city?: string | null, state?: string | null): Location | null {
  const raw = clean(city);
  if (!raw) {
    const s = stateEntry(state);
    return s ? { country: INDIA, state: s.name, district: null, city: null } : null;
  }
  const known = stateEntry(state);
  const inState = <T extends { stateCode: string }>(rows: T[]) => (known ? rows.filter((r) => r.stateCode === known.code) : rows);

  const districts = inState(districtEntries(raw));
  if (districts.length === 1) {
    const d = districts[0];
    // The district's own namesake town is usually where the member actually is.
    return { country: INDIA, state: d.state, district: d.district, city: townEntryIn(d.stateCode, d.district, raw) };
  }

  const towns = inState(townEntries(raw));
  if (towns.length === 1) {
    const t = towns[0];
    return { country: INDIA, state: t.state, district: t.district, city: t.town };
  }

  return null;
}

/** "Kadi, Mehsana, Gujarat" — the display line, skipping whatever is missing or repeated. */
export function locationLine(m: { city?: string | null; district?: string | null; state?: string | null }): string {
  const parts = [clean(m.city), clean(m.district), clean(m.state)].filter(Boolean);
  return parts.filter((p, i) => parts.findIndex((q) => fold(q) === fold(p)) === i).join(", ");
}
