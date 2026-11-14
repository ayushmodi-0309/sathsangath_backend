/**
 * Adds 5 test members (photos uploaded to the configured object storage).
 * TEST ENVIRONMENTS ONLY. Safe to re-run: members whose phone already exists are skipped.
 * Member login: mobile number or profile code + password "Demo@1234".
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/db";
import { storage, newKey } from "../src/lib/storage";
import { nextProfileCode } from "../src/lib/util";
import { resolveLegacyCity } from "../src/lib/locations";

const PASSWORD = "Demo@1234";
type T = { name: string; gender: "MALE" | "FEMALE"; phone: string; community: string; city: string; age: number; education: string; profession: string; photo: string; status: "APPROVED" | "PENDING" };
const TEST: T[] = [
  { name: "Test Aarav Mehta", gender: "MALE", phone: "9000000001", community: "Gujarati", city: "Ahmedabad", age: 29, education: "Post Graduate", profession: "Engineer", photo: "male-3.jpg", status: "APPROVED" },
  { name: "Test Riya Shah", gender: "FEMALE", phone: "9000000002", community: "Gujarati", city: "Ahmedabad", age: 26, education: "Graduate", profession: "Service", photo: "female-1.jpg", status: "APPROVED" },
  { name: "Test Krupa Patel", gender: "FEMALE", phone: "9000000003", community: "Patel", city: "Surat", age: 25, education: "Post Graduate", profession: "Doctor", photo: "female-2.jpg", status: "APPROVED" },
  { name: "Test Harsh Desai", gender: "MALE", phone: "9000000004", community: "Gujarati", city: "Surat", age: 30, education: "Professional", profession: "Business", photo: "male-1.jpg", status: "APPROVED" },
  { name: "Test Sneha Trivedi", gender: "FEMALE", phone: "9000000005", community: "Gujarati", city: "Vadodara", age: 27, education: "Graduate", profession: "Service", photo: "female-7.jpg", status: "PENDING" },
];

/** The town, district and state for a seeded city, from the closed list the API checks against. */
function seedPlace(city: string) {
  const place = resolveLegacyCity(city);
  if (!place) throw new Error(`Seed city "${city}" is not in the location list — see src/lib/locations.ts`);
  return { city: place.city, district: place.district, state: place.state };
}

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  for (const t of TEST) {
    if (await prisma.member.findUnique({ where: { phone: t.phone } })) { console.log("skip (exists):", t.name); continue; }
    const key = newKey("photos", t.photo);
    await storage.put(key, fs.readFileSync(path.join(__dirname, "seed-photos", t.photo)), "image/jpeg");
    const dob = new Date(); dob.setFullYear(dob.getFullYear() - t.age); dob.setMonth(2, 14);
    const approved = t.status === "APPROVED";
    const tagKeys = [["Community", t.community], ["City", t.city], ["Education", t.education], ["Profession", t.profession]];
    const tags = approved ? (await Promise.all(tagKeys.map(([c, v]) => prisma.tagValue.findFirst({ where: { value: v, category: { name: c } } })))).filter((x) => x) : [];
    const m = await prisma.member.create({
      data: {
        profileCode: await nextProfileCode(), status: t.status, approvedAt: approved ? new Date() : null, source: "ADMIN", consentGiven: true,
        fullName: t.name, phone: t.phone, email: `${t.name.split(" ")[1].toLowerCase()}.test@example.com`, gender: t.gender, dob,
        heightCm: t.gender === "MALE" ? 174 : 160, maritalStatus: "Never married", community: t.community, ...seedPlace(t.city),
        education: t.education, profession: t.profession, diet: "Vegetarian", about: "Test profile for QA.",
        photoUrl: key, photos: { create: [{ url: key, isMain: true }] },
        passwordHash: approved ? hash : null, mustChangePassword: false,
        tags: { create: tags.map((x) => ({ tagValueId: x!.id })) },
      },
    });
    console.log("created:", m.profileCode, t.name, t.status, t.phone);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
