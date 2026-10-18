/**
 * Labels shared by the Volunteer Hub. Codes are stored; labels are shown. Keep codes stable.
 * day_of_week convention everywhere in the Hub: 0 = Monday … 6 = Sunday.
 */
export const INVOLVEMENT = [
  { code: "volunteer", label: "Volunteer" },
  { code: "manager", label: "Manager / coach" },
  { code: "official", label: "Club official" },
  { code: "other", label: "Other" },
] as const;
export type InvolvementCode = (typeof INVOLVEMENT)[number]["code"];

/** The nine former duty types: now OPTIONAL interest tags and responsibility labels only. */
export const DUTY_TAGS = [
  { code: "site_lead", label: "Site lead / duty manager" },
  { code: "open_unlock", label: "Open and unlock facilities" },
  { code: "lock_secure", label: "Lock and secure facilities" },
  { code: "gate_admissions", label: "Gate / admission collection" },
  { code: "refreshments", label: "Refreshments / tea bar" },
  { code: "pitch_setup", label: "Pitch and equipment setup" },
  { code: "facility_checks", label: "Changing room / facility checks" },
  { code: "cleaning", label: "Post-event cleaning" },
  { code: "general_support", label: "General volunteer support" },
] as const;

/** Public questionnaire interest categories (03 §3, step 2). */
export const INTEREST_GROUPS = [
  { group: "Matchdays", items: [
    { code: "gate_admissions", label: "Gate / admission" },
    { code: "refreshments", label: "Refreshments / café" },
    { code: "pitch_setup", label: "Pitch and equipment setup" },
    { code: "event_support", label: "Event support" },
  ] },
  { group: "Grounds and facilities", items: [
    { code: "pitch_marking", label: "Pitch marking" },
    { code: "maintenance", label: "Maintenance / DIY" },
    { code: "open_close", label: "Opening and closing" },
    { code: "cleaning", label: "Cleaning" },
  ] },
  { group: "Football", items: [
    { code: "coaching", label: "Team management / coaching" },
    { code: "youth_activities", label: "Youth activities (subject to checks)" },
    { code: "vets_ladies_support", label: "Veterans / Ladies support" },
  ] },
  { group: "Club administration", items: [
    { code: "secretary", label: "Club, senior or youth secretary" },
    { code: "finance", label: "Finance / bookkeeping" },
    { code: "welfare", label: "Welfare / safeguarding (subject to vetting)" },
    { code: "governance", label: "Committee / governance" },
  ] },
  { group: "Promotion and events", items: [
    { code: "social_media", label: "Social media" },
    { code: "website", label: "Website / digital" },
    { code: "photography", label: "Photography / video" },
    { code: "fundraising", label: "Fundraising / sponsorship" },
    { code: "community_events", label: "Community events" },
  ] },
] as const;

type Tag = { code: string; label: string };
/** Every interest the Hub knows: questionnaire categories first, then the nine duty tags. */
export const ALL_INTERESTS: Tag[] = [
  ...new Map(([...INTEREST_GROUPS.flatMap((g) => g.items as readonly Tag[]), ...(DUTY_TAGS as readonly Tag[])]).map((i) => [i.code, i] as const)).values(),
];

export const INTEREST_CODES: string[] = [
  ...new Set([...INTEREST_GROUPS.flatMap((g) => g.items.map((i) => i.code)), ...DUTY_TAGS.map((d) => d.code)]),
];

export const STRENGTHS = [
  { code: "organisation", label: "Organisation" },
  { code: "communication", label: "Communication" },
  { code: "administration", label: "Administration" },
  { code: "finance", label: "Finance" },
  { code: "it", label: "IT / spreadsheets" },
  { code: "creative", label: "Social media / creative" },
  { code: "practical", label: "Practical / DIY" },
  { code: "groundskeeping", label: "Groundskeeping" },
  { code: "coaching", label: "Coaching / sport" },
  { code: "people", label: "People / community" },
  { code: "events", label: "Event planning" },
  { code: "fundraising", label: "Fundraising / sales" },
  { code: "other", label: "Other" },
] as const;
export const STRENGTH_CODES: string[] = STRENGTHS.map((s) => s.code);

export const COMMITMENT_BUCKETS = [
  { code: "lt2", label: "Less than 2 hours a month" },
  { code: "2to4", label: "2–4 hours a month" },
  { code: "5to10", label: "5–10 hours a month" },
  { code: "10plus", label: "10+ hours a month" },
  { code: "varies", label: "Varies / not sure" },
] as const;

export const COMMITMENT_PATTERNS = [
  { code: "regular", label: "Regular" },
  { code: "occasional", label: "Occasional, when needed" },
  { code: "one_off", label: "One-off events or projects" },
  { code: "unsure", label: "Not sure yet" },
] as const;

export const LOCATION_PREFS = [
  { code: "onsite", label: "On site" },
  { code: "remote", label: "From home / remote" },
  { code: "either", label: "Either" },
] as const;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DAYPARTS = [
  { code: "morning", label: "Morning" },
  { code: "afternoon", label: "Afternoon" },
  { code: "evening", label: "Evening" },
] as const;

export function labelFor(list: readonly { code: string; label: string }[], code: string | null | undefined): string {
  if (!code) return "";
  return list.find((x) => x.code === code)?.label ?? code;
}

export function interestLabel(code: string): string {
  for (const g of INTEREST_GROUPS) for (const i of g.items) if (i.code === code) return i.label;
  return labelFor(DUTY_TAGS, code);
}

/** Phone numbers are stored normalised (UK 07… → +447…); show UK numbers the familiar way. */
export function formatPhone(p: string | null | undefined): string {
  if (!p) return "";
  const m = /^\+44(\d{4})(\d{6})$/.exec(p);
  if (m) return `0${m[1]} ${m[2]}`;
  return p;
}

/** Mirror of public._hub_normalize_phone (kept identical; tested). */
export function normalizePhone(p: string | null | undefined): string | null {
  const v = (p ?? "").trim().replace(/[^0-9+]/g, "");
  if (!v) return null;
  if (/^0[0-9]{9,10}$/.test(v)) return `+44${v.slice(1)}`;
  if (/^44[0-9]{9,10}$/.test(v)) return `+${v}`;
  return v;
}
