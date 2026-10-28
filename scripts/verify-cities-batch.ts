import { readFileSync, writeFileSync } from "node:fs";
import { verifyCity } from "../src/lib/cities";
import { checkPhone } from "../src/lib/phone";

// Used by the data-import tooling: verifies (country, city) and (country, phone) pairs with the same rules as the signup form.
const [inFile, outFile] = process.argv.slice(2);
const input = JSON.parse(readFileSync(inFile, "utf8")) as { cities: [string, string][]; phones: [string, string][] };
const cities: Record<string, unknown> = {};
for (const [cc, city] of input.cities) {
  try { cities[`${cc}|${city}`] = verifyCity(cc as never, city, undefined) ?? null; } catch { cities[`${cc}|${city}`] = null; }
}
const phones: Record<string, unknown> = {};
for (const [cc, ph] of input.phones) {
  try { phones[`${cc}|${ph}`] = checkPhone(ph, cc as never); } catch { phones[`${cc}|${ph}`] = { ok: false, error: "check failed" }; }
}
writeFileSync(outFile, JSON.stringify({ cities, phones }));
