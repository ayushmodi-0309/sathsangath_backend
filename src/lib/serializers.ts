import type { Member, MemberTag, TagValue, TagCategory, Photo } from "@prisma/client";
import { ageFrom, list } from "./util";
import { resolveUrl } from "./storage";

type FullMember = Member & { tags?: (MemberTag & { tagValue: TagValue & { category: TagCategory } })[]; photos?: Photo[] };
const mainOnly = (ps: Photo[]) => { const main = ps.find((p) => p.isMain) ?? ps[0]; return main ? [main] : []; };
const toPhotos = (m: FullMember) => Promise.all((m.photos ?? []).map(async (p) => ({ id: p.id, url: (await resolveUrl(p.url))!, isMain: p.isMain })));

/**
 * PRIVACY: this is the ONLY shape another member ever receives.
 * Name, phone, email, family contacts, DOB and the original document are never included —
 * masking happens here on the server, not with CSS.
 */
export async function toPublicProfile(m: FullMember, allPhotos = false) {
  return {
    id: m.id,
    profileCode: m.profileCode,
    gender: m.gender,
    age: ageFrom(m.dob),
    heightCm: m.heightCm,
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
    // Other members see only the main photo until both have liked each other.
    photos: await toPhotos(allPhotos ? m : { ...m, photos: mainOnly(m.photos ?? []) }),
  };
}

/**
 * After BOTH members have liked each other the other side also sees the full name.
 * Phone, email and family contacts still stay private: only the admin shares those.
 */
export const toMutualProfile = async (m: FullMember) => ({
  ...(await toPublicProfile(m, true)), fullName: m.fullName, mutual: true,
  income: m.income, // revealed only after a mutual like, and deliberately not filterable
  prefs: {
    ageMin: m.prefAgeMin, ageMax: m.prefAgeMax, minHeightCm: m.prefHeightMinCm, maritalStatus: m.prefMaritalStatus, relocate: m.prefRelocate,
    communities: list(m.prefCommunities), cities: list(m.prefCities), notes: m.prefNotes,
  },
});

/** A member's own account: includes their own contact details, never admin notes. */
export async function toSelf(m: FullMember) {
  return {
    ...(await toPublicProfile(m, true)),
    fullName: m.fullName, phone: m.phone, email: m.email,
    income: m.income, fatherName: m.fatherName, motherName: m.motherName, createdBy: m.createdBy,
    familyPhone: m.familyPhone, familyEmail: m.familyEmail,
    dob: m.dob, status: m.status, mustChangePassword: m.mustChangePassword,
    prefs: { communities: list(m.prefCommunities), cities: list(m.prefCities), ageMin: m.prefAgeMin, ageMax: m.prefAgeMax, notes: m.prefNotes, minHeightCm: m.prefHeightMinCm, maritalStatus: m.prefMaritalStatus, relocate: m.prefRelocate },
  };
}

/** Full record: admin only. */
export async function toAdminMember(m: FullMember) {
  const { passwordHash, idProofUrl, ...rest } = m;
  return {
    ...rest, age: ageFrom(m.dob), hasPassword: !!passwordHash, hasIdProof: !!idProofUrl, photoUrl: await resolveUrl(m.photoUrl), photos: await toPhotos(m),
    prefCommunities: list(m.prefCommunities), prefCities: list(m.prefCities),
    tags: (m.tags ?? []).map((t) => ({ id: t.tagValueId, value: t.tagValue.value, category: t.tagValue.category.name })),
  };
}
