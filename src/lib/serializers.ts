import type { Member, MemberTag, TagValue, TagCategory, Photo, MembershipPlan } from "@prisma/client";
import { ageFrom, list } from "./util";
import { resolveUrl } from "./storage";

function activePlan(plans: MembershipPlan[]): MembershipPlan | null {
  const now = new Date();
  return plans
    .filter((p) => p.startDate <= now && (p.endDate === null || p.endDate >= now))
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0] ?? null;
}

type FullMember = Member & { tags?: (MemberTag & { tagValue: TagValue & { category: TagCategory } })[]; photos?: Photo[]; membershipPlans?: MembershipPlan[] };
const mainOnly = (ps: Photo[]) => { const main = ps.find((p) => p.isMain) ?? ps[0]; return main ? [main] : []; };
/**
 * Exactly one photo goes out as the main one, whatever the rows say.
 * syncMainPhoto keeps the database to that rule, but a member left with
 * several mains by an older write would otherwise wear a "Main photo" badge on
 * each of their photos in the app and on the web, so the shape settles it too:
 * the first main photo, or the first photo when none is marked. Queries order
 * photos by isMain and then oldest first, so that is the longest-standing one.
 */
const toPhotos = (m: FullMember) => {
  const ps = m.photos ?? [];
  const mainId = (ps.find((p) => p.isMain) ?? ps[0])?.id;
  return Promise.all(ps.map(async (p) => ({ id: p.id, url: (await resolveUrl(p.url))!, isMain: p.id === mainId })));
};

/**
 * PRIVACY: this is the ONLY shape another member ever receives.
 * Name, phone, email, family contacts, DOB and the original document are never included —
 * masking happens here on the server, not with CSS. Nothing unlocks a contact
 * detail for another member: not a mutual like, not a facilitated
 * introduction. Only the member themselves and the admin see those.
 *
 * birthTime and birthPlace are horoscope data and are admin-only: they appear in
 * toAdminMember and in no member-facing shape, not even toSelf. Do not add them here.
 */
export async function toPublicProfile(m: FullMember, allPhotos = false) {
  return {
    id: m.id,
    profileCode: m.profileCode,
    gender: m.gender,
    age: ageFrom(m.dob),
    heightCm: m.heightCm,
    weightKg: m.weightKg,
    maritalStatus: m.maritalStatus,
    community: m.community,
    subCommunity: m.subCommunity,
    city: m.city,
    state: m.state,
    education: m.education,
    profession: m.profession,
    diet: m.diet,
    fatherOccupation: m.fatherOccupation,
    motherOccupation: m.motherOccupation,
    siblings: m.siblings,
    familyBackground: m.familyBackground,
    about: m.about,
    photoUrl: await resolveUrl(m.photoUrl),
    motherTongue: m.motherTongue,
    familyType: m.familyType,
    nativePlace: m.nativePlace, // public: members can filter by it
    // Where they live and, if that is outside India, the kind of visa or
    // status they hold. Both are public: it is the first thing a family asks
    // and they already filter on country, so withholding it until a mutual
    // like only made people ask us instead. The expiry date and the document
    // itself stay private.
    country: m.country,
    visaType: m.visaType,
    // Other members see only the main photo until both have liked each other.
    photos: await toPhotos(allPhotos ? m : { ...m, photos: mainOnly(m.photos ?? []) }),
  };
}

/**
 * After BOTH members have liked each other the other side also sees the full name,
 * date of birth, religion, parents' names and income. (Country is public —
 * see toPublicProfile.)
 * Phone, email and family contacts still stay private: only the admin shares those.
 */
export const toMutualProfile = async (m: FullMember) => ({
  ...(await toPublicProfile(m, true)), fullName: m.fullName, mutual: true,
  dob: m.dob, dobIsApproximate: m.dobIsApproximate,
  religion: m.religion,
  fatherName: m.fatherName,
  motherName: m.motherName,
  income: m.income, // revealed only after a mutual like, and deliberately not filterable
  prefs: {
    ageMin: m.prefAgeMin, ageMax: m.prefAgeMax, minHeightCm: m.prefHeightMinCm, maritalStatus: m.prefMaritalStatus, relocate: m.prefRelocate,
    communities: list(m.prefCommunities), cities: list(m.prefCities),
    education: list(m.prefEducation), occupation: list(m.prefOccupation),
    countries: list(m.prefCountries), incomeMin: m.prefIncomeMin, notes: m.prefNotes,
  },
});

/*
 * There is deliberately no member-facing shape that carries contact details.
 *
 * An arranged introduction does NOT reveal a phone number or an email address:
 * our team passes those between the families themselves. Only the member
 * (toSelf) and the admin (toAdminMember) ever see them. This used to be a
 * toContactProfile() that unlocked after an introduction was facilitated —
 * if you are looking for it, that was the bug, and it is gone.
 */

/** A member's own account: includes their own contact details, never admin notes. */
export async function toSelf(m: FullMember) {
  const ap = activePlan(m.membershipPlans ?? []);
  return {
    ...(await toPublicProfile(m, true)),
    fullName: m.fullName, phone: m.phone, email: m.email,
    income: m.income, fatherName: m.fatherName, motherName: m.motherName, createdBy: m.createdBy,
    religion: m.religion, country: m.country,
    familyPhone: m.familyPhone, familyEmail: m.familyEmail,
    dob: m.dob, dobIsApproximate: m.dobIsApproximate, status: m.status, mustChangePassword: m.mustChangePassword,
    // Members who signed up with Google have no password yet; the settings screen offers to create one.
    hasPassword: !!m.passwordHash,
    visaType: m.visaType, visaExpiry: m.visaExpiry,
    // What our team asked the member to change. adminNote is also used to record
    // why an account was suspended or restricted, which is internal, so it is
    // only handed over for the statuses where it was written for the member.
    adminNote: m.status === "CORRECTION" || m.status === "REJECTED" ? m.adminNote : null,
    prefs: {
      communities: list(m.prefCommunities), cities: list(m.prefCities),
      education: list(m.prefEducation), occupation: list(m.prefOccupation),
      countries: list(m.prefCountries), ageMin: m.prefAgeMin, ageMax: m.prefAgeMax, incomeMin: m.prefIncomeMin,
      notes: m.prefNotes, minHeightCm: m.prefHeightMinCm, maritalStatus: m.prefMaritalStatus, relocate: m.prefRelocate,
    },
    currentPlan: ap ? { plan: ap.plan, endDate: ap.endDate } : null,
  };
}

/** Full record: admin only. */
export async function toAdminMember(m: FullMember) {
  const { passwordHash, idProofUrl, ...rest } = m;
  const ap = activePlan(m.membershipPlans ?? []);
  return {
    ...rest, age: ageFrom(m.dob), hasPassword: !!passwordHash, hasIdProof: !!idProofUrl, photoUrl: await resolveUrl(m.photoUrl), photos: await toPhotos(m),
    prefCommunities: list(m.prefCommunities), prefCities: list(m.prefCities),
    prefEducation: list(m.prefEducation), prefOccupation: list(m.prefOccupation),
    prefCountries: list(m.prefCountries), prefIncomeMin: m.prefIncomeMin,
    tags: (m.tags ?? []).map((t) => ({ id: t.tagValueId, value: t.tagValue.value, category: t.tagValue.category.name })),
    currentPlan: ap ? { id: ap.id, plan: ap.plan, startDate: ap.startDate, endDate: ap.endDate, note: ap.note } : null,
  };
}
