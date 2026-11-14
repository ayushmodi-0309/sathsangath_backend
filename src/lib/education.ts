/**
 * The canonical "highest education" list.
 *
 * A mirror of `sathsangath_frontend/lib/education.ts` — the two live in separate repositories, so
 * the values are duplicated rather than imported. They must stay identical: the web renders the
 * picker from its copy, and this copy is what seeds the Education tag category and what decides
 * whether a submitted value is on the list.
 *
 * One degree is stored on the member. Its `group` (field of study) and `level` (attainment) are
 * derived here, so a filter can roll the stored value up by either without the two dimensions
 * becoming ambiguous choices in one flat list.
 */

export type EduLevel = "School" | "Diploma" | "Bachelors" | "Masters" | "Doctorate";

/** The attainment ladder, lowest first. Exported so a filter can offer "X and above". */
export const EDU_LEVELS: EduLevel[] = ["School", "Diploma", "Bachelors", "Masters", "Doctorate"];

export const EDU_LEVEL_LABEL: Record<EduLevel, string> = {
  School: "School",
  Diploma: "Diploma / ITI",
  Bachelors: "Graduate",
  Masters: "Post Graduate",
  Doctorate: "Doctorate",
};

export type EduDegree = { value: string; level: EduLevel };
export type EduGroup = { group: string; degrees: EduDegree[] };

/** The residual. Always last, and never offered as a filter facet. */
export const EDUCATION_OTHER = "Other";

const B: EduLevel = "Bachelors", M: EduLevel = "Masters", D: EduLevel = "Doctorate";
const DIP: EduLevel = "Diploma", S: EduLevel = "School";

export const EDUCATION_TAXONOMY: EduGroup[] = [
  {
    group: "School & Diploma",
    degrees: [
      { value: "Class 10 or below", level: S },
      { value: "Class 12", level: S },
      { value: "Diploma (Polytechnic)", level: DIP },
      { value: "ITI / Trade certificate", level: DIP },
    ],
  },
  {
    group: "Engineering & Technology",
    degrees: [
      { value: "B.E / B.Tech", level: B },
      { value: "B.Sc Engineering", level: B },
      { value: "A.M.I.E.", level: B },
      { value: "B.Tech LL.B.", level: B },
      { value: "M.E / M.Tech", level: M },
      { value: "M.S. (Engineering)", level: M },
      { value: "PhD (Engineering)", level: D },
    ],
  },
  {
    group: "Computers & IT",
    degrees: [
      { value: "B.C.A.", level: B },
      { value: "B.Sc Computer Science / IT", level: B },
      { value: "M.C.A.", level: M },
      { value: "M.Sc Computer Science / IT", level: M },
      { value: "P.G.D.C.A.", level: M },
      { value: "PhD (Computer Science)", level: D },
    ],
  },
  {
    group: "Medicine & Health",
    degrees: [
      { value: "M.B.B.S.", level: B },
      { value: "B.D.S.", level: B },
      { value: "B.A.M.S.", level: B },
      { value: "B.H.M.S.", level: B },
      { value: "B.U.M.S.", level: B },
      { value: "B.Pharma", level: B },
      { value: "B.P.T. (Physiotherapy)", level: B },
      { value: "B.Sc Nursing", level: B },
      { value: "B.V.Sc. (Veterinary)", level: B },
      { value: "B.Optom / B.Sc Optometry", level: B },
      { value: "Diploma in Paramedical", level: DIP },
      { value: "M.D.", level: M },
      { value: "M.S. (Surgery)", level: M },
      { value: "M.D.S.", level: M },
      { value: "M.Pharma", level: M },
      { value: "M.P.T. (Physiotherapy)", level: M },
      { value: "M.Sc Nursing", level: M },
      { value: "D.M. / M.Ch (Super-speciality)", level: D },
      { value: "Pharm.D", level: D },
      { value: "PhD (Medicine / Health)", level: D },
    ],
  },
  {
    group: "Commerce & Finance",
    degrees: [
      { value: "B.Com", level: B },
      { value: "B.A. Economics", level: B },
      { value: "B.Com LL.B.", level: B },
      { value: "M.Com", level: M },
      { value: "M.A. Economics", level: M },
      { value: "C.A. (Chartered Accountant)", level: M },
      { value: "C.S. (Company Secretary)", level: M },
      { value: "I.C.W.A. / C.M.A.", level: M },
      { value: "C.F.A.", level: M },
      { value: "PhD (Commerce / Economics)", level: D },
    ],
  },
  {
    group: "Management",
    degrees: [
      { value: "B.B.A. / B.M.S.", level: B },
      { value: "M.B.A. / P.G.D.M.", level: M },
      { value: "M.M.S.", level: M },
      { value: "Executive M.B.A.", level: M },
      { value: "F.P.M. / PhD (Management)", level: D },
    ],
  },
  {
    group: "Science",
    degrees: [
      { value: "B.Sc", level: B },
      { value: "M.Sc", level: M },
      { value: "M.Phil (Science)", level: M },
      { value: "PhD (Science)", level: D },
    ],
  },
  {
    group: "Arts & Humanities",
    degrees: [
      { value: "B.A.", level: B },
      { value: "B.F.A. (Fine Arts)", level: B },
      { value: "B.J.M.C. / Journalism", level: B },
      { value: "B.S.W. (Social Work)", level: B },
      { value: "M.A.", level: M },
      { value: "M.F.A.", level: M },
      { value: "M.J.M.C. / Mass Communication", level: M },
      { value: "M.S.W.", level: M },
      { value: "M.Phil (Arts)", level: M },
      { value: "PhD (Arts / Humanities)", level: D },
      { value: "D.Litt.", level: D },
    ],
  },
  {
    group: "Law",
    degrees: [
      { value: "LL.B.", level: B },
      { value: "B.A. LL.B.", level: B },
      { value: "LL.M.", level: M },
      { value: "LL.D. / PhD (Law)", level: D },
    ],
  },
  {
    group: "Education & Teaching",
    degrees: [
      { value: "D.El.Ed. / D.Ed.", level: DIP },
      { value: "B.Ed.", level: B },
      { value: "B.P.Ed.", level: B },
      { value: "M.Ed.", level: M },
      { value: "M.P.Ed.", level: M },
      { value: "PhD (Education)", level: D },
    ],
  },
  {
    group: "Design & Architecture",
    degrees: [
      { value: "B.Arch", level: B },
      { value: "B.Des", level: B },
      { value: "B.F.Tech / B.FAD", level: B },
      { value: "Diploma in Design", level: DIP },
      { value: "M.Arch", level: M },
      { value: "M.Des", level: M },
    ],
  },
  {
    group: "Hospitality, Aviation & Agriculture",
    degrees: [
      { value: "B.H.M. (Hotel Management)", level: B },
      { value: "Diploma in Hotel Management", level: DIP },
      { value: "C.P.L. (Commercial Pilot Licence)", level: DIP },
      { value: "Aviation / Cabin Crew diploma", level: DIP },
      { value: "B.Sc Agriculture", level: B },
      { value: "M.Sc Agriculture", level: M },
    ],
  },
  {
    group: "Other",
    degrees: [{ value: EDUCATION_OTHER, level: B }],
  },
];

/** Every degree, flattened, with its group and level attached. */
export const EDUCATION_DEGREES: (EduDegree & { group: string })[] = EDUCATION_TAXONOMY.flatMap((g) =>
  g.degrees.map((d) => ({ ...d, group: g.group })),
);

/** The stored values, in picker order. This is what seeds the Education tag category. */
export const EDUCATION_VALUES: string[] = EDUCATION_DEGREES.map((d) => d.value);

/** The field-of-study facets, with the residual "Other" group left out. */
export const EDUCATION_GROUPS: string[] = EDUCATION_TAXONOMY.map((g) => g.group).filter((g) => g !== "Other");

const BY_VALUE = new Map(EDUCATION_DEGREES.map((d) => [d.value.toLowerCase(), d]));

/** Looks a stored value up, case-insensitively. Returns null for anything off-list. */
export const educationEntry = (value?: string | null) =>
  value ? BY_VALUE.get(value.trim().replace(/\s+/g, " ").toLowerCase()) ?? null : null;

export const educationGroupOf = (value?: string | null) => educationEntry(value)?.group ?? null;
export const educationLevelOf = (value?: string | null) => educationEntry(value)?.level ?? null;
