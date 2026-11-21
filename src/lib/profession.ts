/**
 * The "profession" taxonomy.
 *
 * Two levels, like education. One value is stored on the member — the role, e.g. "Nurse" — and the
 * group it belongs to ("Healthcare (Non-Doctor)") is derived from the static map below, never
 * stored. A profile shows the precise role; the feed filters can roll up to the group. That is what
 * stops a nurse and a doctor both reading as "Doctor / Medical".
 *
 * Every role sits in exactly one group. There is no sector ("Government" / "Private") field: the
 * list holds roles only, with "(Other)" roles as the catch-all inside each group.
 *
 * Code-owned on purpose. It does not grow from what members type.
 *
 * A mirror of `sathsangath_frontend/lib/profession.ts` — separate repositories, so the data is
 * duplicated rather than imported, and the two must stay identical. This copy seeds the Profession
 * tag category and decides whether a submitted value is on the list.
 */

export type ProfessionGroup = { group: string; roles: string[] };

/** The residual. Always last in the picker, and never offered as a filter facet. */
export const PROFESSION_OTHER = "Other";

export const PROFESSION_TAXONOMY: ProfessionGroup[] = [
  {
    group: "Doctor",
    roles: [
      "Doctor / Physician",
      "Surgeon",
      "Dentist",
      "Veterinary Doctor",
      "Ayurvedic / Homeopathic Doctor",
    ],
  },
  {
    group: "Healthcare (Non-Doctor)",
    roles: [
      "Nurse",
      "Pharmacist",
      "Physiotherapist",
      "Psychologist",
      "Paramedic / Lab Technician",
      "Medical Researcher",
      "Healthcare Professional (Other)",
    ],
  },
  {
    group: "Engineering",
    roles: [
      "Civil Engineer",
      "Mechanical / Production Engineer",
      "Electrical Engineer",
      "Electronics / Telecom Engineer",
      "Chemical Engineer",
      "Engineer (Other)",
    ],
  },
  {
    group: "IT & Software",
    roles: [
      "Software Developer / Programmer",
      "Data / Analytics Professional",
      "QA / Testing Engineer",
      "Cyber / Network Security",
      "Hardware & Networking Professional",
      "IT Consultant",
      "IT Professional (Other)",
    ],
  },
  {
    group: "Business & Trade",
    roles: [
      "Business Owner / Entrepreneur",
      "Startup Founder",
      "Family Business",
      "Self Employed / Freelancer",
      "Industrialist / Manufacturer",
      "Shop Owner / Retailer",
      "Trader / Wholesaler",
      "Jeweller",
      "Diamond Trader / Manufacturer",
      "Textile Trader / Manufacturer",
      "Real Estate / Builder",
      "Construction Business",
      "Automobile Business",
      "Import / Export Business",
      "Transport / Logistics Business",
      "Agent / Broker / Contractor",
    ],
  },
  {
    group: "Finance & Accounting",
    roles: [
      "Chartered Accountant",
      "Cost Accountant (CMA)",
      "Company Secretary",
      "Accounting Professional",
      "Auditor",
      "Banking Professional",
      "Investment / Financial Advisor",
      "Insurance Professional",
      "Finance Professional (Other)",
    ],
  },
  {
    group: "Education & Research",
    roles: [
      "Teacher",
      "Professor / Lecturer",
      "Research Scholar / Assistant",
      "Scientist",
      "Education / Training Professional",
      "Educational Institution Owner",
      "Librarian",
    ],
  },
  {
    group: "Legal",
    roles: ["Lawyer / Advocate", "Legal Professional (Other)"],
  },
  {
    group: "Management & Corporate",
    roles: [
      "CxO / Chairman / Director",
      "VP / AVP / GM",
      "Manager / Sr. Manager",
      "Team Lead / Supervisor",
      "Project / Program Manager",
      "Product Manager",
      "Consultant / Analyst",
      "Operations Manager",
      "Private / Corporate Employee (Other)",
    ],
  },
  {
    group: "Sales & Marketing",
    roles: ["Sales Professional", "Marketing Professional", "Business Development"],
  },
  {
    group: "Admin & HR",
    roles: [
      "Admin Professional",
      "HR Professional",
      "Clerk / Office Staff",
      "Secretary / Front Office",
      "Customer Support / BPO / KPO",
    ],
  },
  {
    group: "Government & Defence",
    roles: [
      "Government Employee (Other)",
      "Civil Services (IAS / IPS / IRS etc.)",
      "Police / Law Enforcement",
      "Army",
      "Navy",
      "Air Force",
      "Defence Services (Other)",
    ],
  },
  {
    group: "Aviation, Marine & Hospitality",
    roles: [
      "Pilot",
      "Air Hostess / Flight Attendant",
      "Airline Professional (Other)",
      "Merchant Navy Officer",
      "Chef / Catering",
      "Hotel & Hospitality Professional",
    ],
  },
  {
    group: "Media & Entertainment",
    roles: [
      "Actor / Model",
      "Singer / Musician",
      "Journalist",
      "Writer",
      "Artist",
      "Photographer / Videographer",
      "Animator / Graphic Designer",
      "Web / UI-UX Designer",
      "Advertising / PR Professional",
      "Event Manager",
      "Media Professional (Other)",
    ],
  },
  {
    group: "Architecture, Fashion & Beauty",
    roles: [
      "Architect",
      "Interior Designer",
      "Fashion Designer",
      "Jewellery Designer",
      "Beautician / Hairstylist",
    ],
  },
  {
    group: "Agriculture",
    roles: ["Farming", "Agriculture Professional"],
  },
  {
    group: "Services & Others",
    roles: [
      "Social Worker / NGO",
      "Politician",
      "Sportsperson / Fitness Professional",
      "Travel / Transport Professional",
      "Security Professional",
      "Technician / Operator",
    ],
  },
  {
    group: "Not Working",
    roles: ["Student", "Homemaker", "Not Working", "Retired"],
  },
  {
    group: "Other",
    roles: [PROFESSION_OTHER],
  },
];

/** Every value that may be stored, in picker order, with the residual last. */
export const PROFESSIONS: string[] = PROFESSION_TAXONOMY.flatMap((g) => g.roles);

/** The filter facets: the groups, without the residual. */
export const PROFESSION_GROUPS: string[] = PROFESSION_TAXONOMY.map((g) => g.group).filter((g) => g !== "Other");

/** Every role except the residual — the leaf level of the filter. */
export const PROFESSION_FACETS: string[] = PROFESSIONS.filter((p) => p !== PROFESSION_OTHER);

const BY_VALUE = new Map(PROFESSIONS.map((p) => [p.toLowerCase(), p]));
const GROUP_OF = new Map(PROFESSION_TAXONOMY.flatMap((g) => g.roles.map((r) => [r, g.group] as const)));

/**
 * The values this list replaced, mapped to the role they fold onto.
 *
 * Old app builds, and members who have not been migrated yet, still send these. Where the old value
 * covered several roles ("Doctor / Medical") it lands on that group's "(Other)" role rather than
 * guessing one; where it spanned groups ("Police / Defence", "Aviation / Hospitality") it lands on
 * "Other". Keys are lower-case.
 */
export const LEGACY_PROFESSIONS: Record<string, string> = {
  "doctor / medical": "Healthcare Professional (Other)",
  "engineer": "Engineer (Other)",
  "it / software": "IT Professional (Other)",
  "business / entrepreneur": "Business Owner / Entrepreneur",
  "government job": "Government Employee (Other)",
  "private job": "Private / Corporate Employee (Other)",
  "banking / finance / ca": "Finance Professional (Other)",
  "education / teaching": "Education / Training Professional",
  "lawyer / legal": "Lawyer / Advocate",
  "management / administration": "Private / Corporate Employee (Other)",
  "marketing / sales / hr": "Private / Corporate Employee (Other)",
  "police / defence": PROFESSION_OTHER,
  "aviation / hospitality": PROFESSION_OTHER,
  "media / designing": "Media Professional (Other)",
  "agriculture / farming": "Farming",
};

/** Looks a stored value up, case-insensitively. Returns null for anything off-list. */
export const professionEntry = (value?: string | null) =>
  value ? BY_VALUE.get(value.trim().replace(/\s+/g, " ").toLowerCase()) ?? null : null;

/** The group a stored role belongs to, or null for an unknown value. */
export const professionGroupOf = (value?: string | null) => {
  const role = professionEntry(value);
  return role ? GROUP_OF.get(role) ?? null : null;
};

/** The old-list value's replacement, or null when the value was never on the old list. */
export const legacyProfession = (value?: string | null) =>
  value ? LEGACY_PROFESSIONS[value.trim().replace(/\s+/g, " ").toLowerCase()] ?? null : null;

/** The roles in one group — what a group tick in the filter expands to. */
export const rolesOfGroup = (group: string): string[] =>
  PROFESSION_TAXONOMY.find((g) => g.group === group)?.roles ?? [];

export const isKnownProfession = (value?: string | null) => professionEntry(value) !== null;
