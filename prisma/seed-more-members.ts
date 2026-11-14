/**
 * Adds 10 varied APPROVED test members (5 grooms, 5 brides) so filters and their combinations can be tried properly.
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
type T = {
  name: string; gender: "MALE" | "FEMALE"; phone: string; age: number; heightCm: number; marital: string;
  community: string; sub?: string; city: string; state: string; native: string; tongue: string; family: string;
  education: string; profession: string; income: string; diet: string; photo?: string;
  father: string; mother: string; siblings: string; about: string; prefAge: [number, number]; prefHeight?: number; prefMarital?: string; relocate?: string;
};
const TEST: T[] = [
  { name: "Test Dhruv Joshi", gender: "MALE", phone: "9000000011", age: 27, heightCm: 178, marital: "Never married", community: "Brahmin", sub: "Audichya", city: "Ahmedabad", state: "Gujarat", native: "Rajkot", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹15–20 lakh", diet: "Vegetarian", photo: "male-2.jpg", father: "Retired teacher", mother: "Homemaker", siblings: "1 sister", about: "Software architect who loves trekking and classical music.", prefAge: [23, 28], prefHeight: 155, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Test Karan Oswal", gender: "MALE", phone: "9000000012", age: 33, heightCm: 172, marital: "Divorced", community: "Jain", sub: "Oswal", city: "Mumbai", state: "Maharashtra", native: "Jodhpur", tongue: "Marwari", family: "Nuclear", education: "Professional", profession: "Business", income: "₹30–50 lakh", diet: "Jain", photo: "male-4.jpg", father: "Businessman", mother: "Homemaker", siblings: "1 brother", about: "Runs a textile trading firm. Looking for a settled, family-oriented partner.", prefAge: [26, 33], prefMarital: "Any", relocate: "Yes" },
  { name: "Test Mihir Parekh", gender: "MALE", phone: "9000000013", age: 24, heightCm: 168, marital: "Never married", community: "Patel", sub: "Leuva", city: "Surat", state: "Gujarat", native: "Navsari", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Service", income: "₹5–7 lakh", diet: "Vegetarian", photo: "male-6.jpg", father: "Diamond trader", mother: "Homemaker", siblings: "2 brothers", about: "Bank officer, enjoys cricket and cooking.", prefAge: [21, 26], relocate: "No" },
  { name: "Test Rahul Khanna", gender: "MALE", phone: "9000000014", age: 36, heightCm: 183, marital: "Widowed", community: "Gujarati", sub: "Lohana", city: "Vadodara", state: "Gujarat", native: "Vadodara", tongue: "Hindi", family: "Nuclear", education: "Post Graduate", profession: "Doctor", income: "₹30–50 lakh", diet: "Eggetarian", father: "Retired professor", mother: "Retired nurse", siblings: "None", about: "Orthopaedic surgeon. Single father of one child.", prefAge: [28, 36], prefMarital: "Any", relocate: "Maybe" },
  { name: "Test Sahil Marwah", gender: "MALE", phone: "9000000015", age: 30, heightCm: 175, marital: "Never married", community: "Marwari", sub: "Agarwal", city: "Rajkot", state: "Gujarat", native: "Bikaner", tongue: "Marwari", family: "Joint", education: "Professional", profession: "Chartered Accountant", income: "₹20–30 lakh", diet: "Vegetarian", photo: "male-8.jpg", father: "CA", mother: "Homemaker", siblings: "1 sister", about: "Practising CA with a small firm of my own.", prefAge: [24, 29], prefHeight: 158, prefMarital: "Never married", relocate: "Yes" },
  { name: "Test Ananya Vyas", gender: "FEMALE", phone: "9000000016", age: 25, heightCm: 160, marital: "Never married", community: "Brahmin", sub: "Nagar", city: "Ahmedabad", state: "Gujarat", native: "Junagadh", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹10–15 lakh", diet: "Vegetarian", photo: "female-3.jpg", father: "Government officer", mother: "Homemaker", siblings: "1 brother", about: "Data engineer who paints in her free time.", prefAge: [26, 32], prefHeight: 170, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Test Pooja Lalwani", gender: "FEMALE", phone: "9000000017", age: 29, heightCm: 157, marital: "Never married", community: "Gujarati", sub: "Sindhi", city: "Mumbai", state: "Maharashtra", native: "Ahmedabad", tongue: "Sindhi", family: "Nuclear", education: "Graduate", profession: "Business", income: "₹7–10 lakh", diet: "Vegetarian", photo: "female-5.jpg", father: "Businessman", mother: "Homemaker", siblings: "1 sister", about: "Runs a boutique. Close to family, loves travelling.", prefAge: [29, 35], relocate: "Yes" },
  { name: "Test Nisha Doshi", gender: "FEMALE", phone: "9000000018", age: 31, heightCm: 163, marital: "Divorced", community: "Jain", sub: "Shwetambar", city: "Surat", state: "Gujarat", native: "Palanpur", tongue: "Gujarati", family: "Nuclear", education: "Post Graduate", profession: "Doctor", income: "₹20–30 lakh", diet: "Jain", photo: "female-8.jpg", father: "Retired banker", mother: "Homemaker", siblings: "None", about: "Dentist with her own clinic. Looking for a kind, understanding partner.", prefAge: [30, 38], prefMarital: "Any", relocate: "No" },
  { name: "Test Simran Kaur", gender: "FEMALE", phone: "9000000019", age: 23, heightCm: 166, marital: "Never married", community: "Gujarati", sub: "Punjabi", city: "Vadodara", state: "Gujarat", native: "Amritsar", tongue: "Punjabi", family: "Joint", education: "Graduate", profession: "Service", income: "₹3–5 lakh", diet: "Non-vegetarian", father: "Army (retd)", mother: "School teacher", siblings: "1 brother", about: "HR executive. Loves music and long drives.", prefAge: [24, 30], prefHeight: 172, relocate: "Maybe" },
  { name: "Test Tanvi Mistry", gender: "FEMALE", phone: "9000000020", age: 27, heightCm: 154, marital: "Awaiting divorce", community: "Patel", sub: "Kadva", city: "Rajkot", state: "Gujarat", native: "Morbi", tongue: "Gujarati", family: "Joint", education: "Professional", profession: "Service", income: "₹7–10 lakh", diet: "Eggetarian", photo: "female-10.jpg", father: "Farmer", mother: "Homemaker", siblings: "2 sisters", about: "Architect working with a design studio.", prefAge: [27, 34], prefMarital: "Any", relocate: "Yes" },
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
    let key: string | null = null;
    if (t.photo) { key = newKey("photos", t.photo); await storage.put(key, fs.readFileSync(path.join(__dirname, "seed-photos", t.photo)), "image/jpeg"); }
    const dob = new Date(); dob.setFullYear(dob.getFullYear() - t.age); dob.setMonth(Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27));
    const tagKeys = [["Community", t.community], ["City", t.city], ["Education", t.education], ["Profession", t.profession]];
    const tags = (await Promise.all(tagKeys.map(([c, v]) => prisma.tagValue.findFirst({ where: { value: v, category: { name: c } } })))).filter((x) => x);
    const m = await prisma.member.create({
      data: {
        profileCode: await nextProfileCode(), status: "APPROVED", approvedAt: new Date(Date.now() - Math.floor(Math.random() * 20) * 86400000), source: "ADMIN", consentGiven: true,
        fullName: t.name, phone: t.phone, email: `${t.name.split(" ")[2].toLowerCase()}.test@example.com`, gender: t.gender, dob,
        heightCm: t.heightCm, maritalStatus: t.marital, community: t.community, subCommunity: t.sub, ...seedPlace(t.city), nativePlace: t.native,
        motherTongue: t.tongue, familyType: t.family, education: t.education, profession: t.profession, income: t.income, diet: t.diet,
        fatherOccupation: t.father, motherOccupation: t.mother, siblings: t.siblings, about: t.about, familyBackground: "Respectable, well-settled family with traditional values.",
        createdBy: "Parent", prefAgeMin: t.prefAge[0], prefAgeMax: t.prefAge[1], prefHeightMinCm: t.prefHeight, prefMaritalStatus: t.prefMarital ?? "Never married", prefRelocate: t.relocate,
        photoUrl: key, ...(key && { photos: { create: [{ url: key, isMain: true }] } }),
        passwordHash: hash, mustChangePassword: false,
        tags: { create: tags.map((x) => ({ tagValueId: x!.id })) },
      },
    });
    console.log("created:", m.profileCode, t.name, t.gender, t.age, t.city, t.phone);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
