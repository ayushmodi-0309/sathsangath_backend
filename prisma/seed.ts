import "dotenv/config";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PHOTO_SRC = path.join(__dirname, "seed-photos");
const PHOTO_DST = path.resolve(process.cwd(), "uploads", "photos");

const TAGS: Record<string, string[]> = {
  Community: ["Gujarati", "Marwari", "Jain", "Patel", "Brahmin"],
  City: ["Ahmedabad", "Surat", "Vadodara", "Mumbai", "Rajkot"],
  Education: ["Graduate", "Post Graduate", "Professional"],
  Profession: ["Business", "Service", "Doctor", "Engineer"],
  // These three start empty on purpose: they fill in from real bio data via learnTagValues().
  "Sub-community": [],
  "Mother tongue": [],
  "Birth Place": [],
};

// code, gender, name, community, city, age, education, profession, photo file, status
type P = [number, "MALE" | "FEMALE", string, string, string, number, string, string, string, "APPROVED" | "PENDING"];
const people: P[] = [
  [1001, "MALE", "Aarav Mehta", "Gujarati", "Ahmedabad", 29, "Post Graduate", "Engineer", "male-3.jpg", "APPROVED"],
  [1002, "FEMALE", "Riya Shah", "Gujarati", "Ahmedabad", 26, "Graduate", "Service", "female-1.jpg", "APPROVED"],
  [1003, "FEMALE", "Krupa Patel", "Patel", "Surat", 25, "Post Graduate", "Doctor", "female-2.jpg", "APPROVED"],
  [1004, "FEMALE", "Mansi Mehta", "Gujarati", "Ahmedabad", 27, "Professional", "Business", "female-3.jpg", "APPROVED"],
  [1005, "FEMALE", "Neha Joshi", "Brahmin", "Vadodara", 28, "Graduate", "Service", "female-4.jpg", "APPROVED"],
  [1006, "FEMALE", "Pooja Agarwal", "Marwari", "Mumbai", 24, "Graduate", "Business", "female-5.jpg", "APPROVED"],
  [1007, "MALE", "Harsh Desai", "Gujarati", "Surat", 30, "Professional", "Business", "male-1.jpg", "APPROVED"],
  [1008, "MALE", "Dhruv Jain", "Jain", "Rajkot", 28, "Post Graduate", "Engineer", "male-2.jpg", "APPROVED"],
  [1009, "FEMALE", "Anjali Jain", "Jain", "Rajkot", 26, "Post Graduate", "Doctor", "female-6.jpg", "APPROVED"],
  [1010, "FEMALE", "Sneha Trivedi", "Gujarati", "Ahmedabad", 27, "Graduate", "Service", "female-7.jpg", "PENDING"],
  [1011, "MALE", "Karan Patel", "Patel", "Surat", 31, "Professional", "Business", "male-4.jpg", "APPROVED"],
  [1012, "MALE", "Rohan Shah", "Gujarati", "Ahmedabad", 27, "Graduate", "Service", "male-5.jpg", "APPROVED"],
  [1013, "MALE", "Yash Joshi", "Brahmin", "Vadodara", 29, "Post Graduate", "Engineer", "male-6.jpg", "APPROVED"],
  [1014, "MALE", "Nirav Agarwal", "Marwari", "Mumbai", 30, "Graduate", "Business", "male-7.jpg", "APPROVED"],
  [1015, "FEMALE", "Isha Desai", "Gujarati", "Ahmedabad", 25, "Post Graduate", "Engineer", "female-8.jpg", "APPROVED"],
  [1016, "FEMALE", "Divya Mehta", "Gujarati", "Surat", 27, "Graduate", "Service", "female-9.jpg", "APPROVED"],
  [1017, "FEMALE", "Hetal Patel", "Patel", "Ahmedabad", 26, "Professional", "Doctor", "female-10.jpg", "APPROVED"],
  [1018, "FEMALE", "Tanvi Shah", "Gujarati", "Rajkot", 24, "Graduate", "Service", "female-11.jpg", "APPROVED"],
  [1019, "MALE", "Parth Jain", "Jain", "Mumbai", 32, "Post Graduate", "Business", "male-8.jpg", "APPROVED"],
  [1020, "FEMALE", "Khushi Joshi", "Brahmin", "Rajkot", 25, "Graduate", "Service", "female-12.jpg", "APPROVED"],
];

/** Copies a sample portrait into the uploads folder under an unguessable name and returns its public URL. */
function addPhoto(file: string) {
  fs.mkdirSync(PHOTO_DST, { recursive: true });
  const name = crypto.randomBytes(16).toString("hex") + ".jpg";
  fs.copyFileSync(path.join(PHOTO_SRC, file), path.join(PHOTO_DST, name));
  return `/uploads/photos/${name}`;
}

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@sathsangath.in").toLowerCase();
  const admin = await prisma.adminUser.upsert({
    where: { email }, update: {},
    create: { name: "Sathsangath Admin", email, role: "SUPER_ADMIN", passwordHash: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345", 11) },
  });

  const tagIndex: Record<string, string> = {};
  for (const [cat, values] of Object.entries(TAGS)) {
    const c = await prisma.tagCategory.upsert({ where: { name: cat }, update: {}, create: { name: cat } });
    for (const v of values) {
      const t = await prisma.tagValue.upsert({ where: { categoryId_value: { categoryId: c.id, value: v } }, update: {}, create: { categoryId: c.id, value: v } });
      tagIndex[`${cat}:${v}`] = t.id;
    }
  }

  // Demo members/likes/photos are only for local development: set SEED_DEMO=true. Never on a real database.
  if (process.env.SEED_DEMO === "true" && (await prisma.member.count()) === 0) {
    const hash = await bcrypt.hash("Demo@1234", 10);
    const byCode: Record<number, { id: string; name: string }> = {};
    for (const [n, gender, fullName, community, city, age, education, profession, photo, status] of people) {
      const dob = new Date(); dob.setFullYear(dob.getFullYear() - age); dob.setMonth(2, 14);
      const phone = `90000000${String(n - 1000).padStart(2, "0")}`;
      const approved = status === "APPROVED";
      const url = addPhoto(photo);
      // the first demo groom also has a second photo, so "choose main photo" can be tried straight away
      const extra = n === 1001 || n === 1002 ? [addPhoto(photo)] : [];
      const m = await prisma.member.create({
        data: {
          profileCode: `SS-${n}`, status, approvedAt: approved ? new Date() : null, source: approved ? "ADMIN" : "WEB", consentGiven: true,
          fullName, phone, email: `${fullName.split(" ")[0].toLowerCase()}${n}@example.com`, familyPhone: `98000000${String(n - 1000).padStart(2, "0")}`, gender, dob,
          heightCm: gender === "MALE" ? 170 + (n % 9) : 154 + (n % 9), maritalStatus: "Never married", community, city, state: city === "Mumbai" ? "Maharashtra" : "Gujarat",
          education, profession, diet: "Vegetarian", fatherOccupation: "Business", motherOccupation: "Homemaker", siblings: n % 2 ? "1 brother" : "1 sister",
          familyBackground: "A close-knit, traditional family that values education and togetherness.",
          about: "Family-oriented, balanced and looking for a caring life partner.",
          photoUrl: url,
          photos: { create: [{ url, isMain: true }, ...extra.map((u) => ({ url: u, isMain: false }))] },
          passwordHash: approved ? hash : null, mustChangePassword: false,
          // Aarav wants a Gujarati bride in Ahmedabad, aged 23-29
          prefCommunities: n === 1001 ? "Gujarati" : "", prefCities: n === 1001 ? "Ahmedabad" : "", prefAgeMin: n === 1001 ? 23 : null, prefAgeMax: n === 1001 ? 29 : null,
          tags: approved ? { create: [`Community:${community}`, `City:${city}`, `Education:${education}`, `Profession:${profession}`].map((k) => ({ tagValueId: tagIndex[k] })) } : undefined,
        },
      });
      byCode[n] = { id: m.id, name: fullName };
    }

    const label = (n: number) => `${byCode[n].name} (SS-${n})`;
    const like = (a: number, b: number) => prisma.like.create({ data: { likerId: byCode[a].id, likedId: byCode[b].id } });

    // Riya already liked Aarav. When Aarav (SS-1001) likes Riya (SS-1002) it becomes a live mutual match.
    await like(1002, 1001);
    // Ready-made mutual match: Harsh <-> Mansi, with notifications for both and the admin.
    await like(1007, 1004); await like(1004, 1007);
    await prisma.notification.createMany({ data: [
      { audience: "MEMBER", memberId: byCode[1007].id, type: "MUTUAL_LIKE", title: "It's a match! 💞", body: "Mansi (SS-1004) liked your profile as well. You can now view their profile properly.", data: JSON.stringify({ memberId: byCode[1004].id }) },
      { audience: "MEMBER", memberId: byCode[1004].id, type: "MUTUAL_LIKE", title: "It's a match! 💞", body: "Harsh (SS-1007) had already liked you. You can now view their profile properly.", data: JSON.stringify({ memberId: byCode[1007].id }) },
      { audience: "ADMIN", type: "MUTUAL_LIKE", title: "Mutual like", body: `${label(1007)} and ${label(1004)} liked each other.`, data: JSON.stringify({ a: byCode[1007].id, b: byCode[1004].id }) },
    ] });
    await prisma.introRequest.create({ data: { requesterId: byCode[1007].id, targetId: byCode[1004].id, message: "Please call after 6 pm" } });

    await prisma.announcement.createMany({ data: [
      { title: "Welcome to Sathsangath", body: "Your curated matches are updated every week. Like a profile you are interested in, and our team will arrange the introduction personally." },
      { title: "Office timings", body: "Our team is available Monday to Friday 10 am – 8 pm and Saturday–Sunday 11 am – 6 pm on WhatsApp and phone." },
    ] });

    await prisma.auditLog.createMany({ data: [
      { actorType: "MEMBER", memberId: byCode[1007].id, actorName: label(1007), action: "LIKED_PROFILE", entity: "Member", entityId: byCode[1004].id },
      { actorType: "MEMBER", memberId: byCode[1004].id, actorName: label(1004), action: "LIKED_PROFILE", entity: "Member", entityId: byCode[1007].id },
      { actorType: "MEMBER", memberId: byCode[1004].id, actorName: label(1004), action: "MUTUAL_MATCH", entity: "Member", entityId: byCode[1007].id },
      { actorType: "MEMBER", memberId: byCode[1007].id, actorName: label(1007), action: "REQUESTED_INTRODUCTION", entity: "IntroRequest" },
      { actorType: "PUBLIC", actorName: label(1010), action: "SUBMITTED_BIODATA", entity: "Member", entityId: byCode[1010].id },
      { actorType: "ADMIN", adminId: admin.id, action: "APPROVE", entity: "Member", entityId: byCode[1004].id },
    ] });
  }
  console.log("Seed complete.");
}
main().finally(() => prisma.$disconnect());
