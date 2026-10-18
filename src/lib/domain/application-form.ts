/**
 * Public volunteer application (spec 03 §3). One schema for the browser (step checks) and the server
 * (authoritative). The database validates a third time. No sensitive data is asked for.
 */
import { z } from "zod";
import { COMMITMENT_BUCKETS, COMMITMENT_PATTERNS, INTEREST_CODES, LOCATION_PREFS, STRENGTH_CODES } from "@/lib/domain/hub-tags";

export const CONNECTIONS = [
  { code: "player", label: "Player" }, { code: "parent_carer", label: "Parent or carer" }, { code: "supporter", label: "Supporter" },
  { code: "former_member", label: "Former member" }, { code: "community", label: "Local community" }, { code: "other", label: "Other" },
  { code: "not_currently", label: "Not currently connected" },
] as const;
export const HEARD_FROM = [
  { code: "friend_family", label: "Friend or family" }, { code: "social_media", label: "Social media" }, { code: "club_event", label: "At a club event" },
  { code: "website", label: "Club website" }, { code: "other", label: "Other" },
] as const;

const codes = (l: readonly { code: string }[]) => l.map((x) => x.code) as [string, ...string[]];
const optionalEnum = (l: readonly { code: string }[]) => z.union([z.literal(""), z.enum(codes(l))]).optional();

export const stepOne = z.object({
  full_name: z.string().trim().min(1, "Enter your name.").max(120, "Names can be up to 120 characters."),
  email: z.union([z.literal(""), z.string().trim().max(254).pipe(z.email({ message: "Enter a valid email address." }))]),
  phone: z.string().trim().max(30, "That phone number is too long.").refine((v) => v === "" || /^\+?[0-9 ()-]{6,20}$/.test(v), "Enter a valid phone number."),
  // Checked below with the other cross-field rules, so every step-1 problem is reported at once.
  contact_preference: z.string(),
  existing_club_connection: optionalEnum(CONNECTIONS),
  heard_from: optionalEnum(HEARD_FROM),
  is_adult: z.boolean(),
}).superRefine((v, ctx) => {
  if (!v.email && !v.phone) ctx.addIssue({ code: "custom", path: ["email"], message: "Give an email address or a phone number (or both)." });
  if (!["email", "phone", "whatsapp", "no_preference"].includes(v.contact_preference)) ctx.addIssue({ code: "custom", path: ["contact_preference"], message: "Choose how we should contact you." });
  if (v.is_adult !== true) ctx.addIssue({ code: "custom", path: ["is_adult"], message: "This form is for adults." });
  if (v.contact_preference === "email" && !v.email) ctx.addIssue({ code: "custom", path: ["contact_preference"], message: "Add an email address, or choose another way to contact you." });
  if ((v.contact_preference === "phone" || v.contact_preference === "whatsapp") && !v.phone) ctx.addIssue({ code: "custom", path: ["contact_preference"], message: "Add a phone number, or choose another way to contact you." });
});

export const stepTwo = z.object({
  interests: z.array(z.string()).max(40).transform((a) => a.filter((x) => INTEREST_CODES.includes(x))),
  unsure_role: z.boolean(),
  selected_position_ids: z.array(z.uuid()).max(20),
  strengths: z.array(z.string()).max(20).transform((a) => a.filter((x) => STRENGTH_CODES.includes(x))),
  experience_text: z.string().trim().max(1000, "Please keep this under 1,000 characters."),
  willing_to_learn: z.union([z.literal(""), z.enum(["yes", "maybe", "no"])]),
}).refine((v) => v.unsure_role || v.interests.length > 0 || v.selected_position_ids.length > 0,
  { path: ["interests"], message: "Pick at least one thing, or “I'm not sure — please help me find a role”." });

export const stepThree = z.object({
  commitment_bucket: z.enum(codes(COMMITMENT_BUCKETS), { message: "Choose roughly how much time you could offer." }),
  commitment_pattern: z.enum(codes(COMMITMENT_PATTERNS), { message: "Choose what kind of involvement suits you." }),
  availability: z.array(z.object({ day: z.number().int().min(0).max(6), daypart: z.enum(["morning", "afternoon", "evening"]) })).max(21),
  availability_varies: z.boolean(),
  work_location_preference: z.enum(codes(LOCATION_PREFS), { message: "Choose where you'd prefer to help." }),
  free_notes: z.string().trim().max(1000, "Please keep this under 1,000 characters."),
  privacy_acknowledged: z.literal(true, { message: "Please confirm you've read the privacy notice." }),
  communication_opt_in: z.boolean(),
});

export type ApplicationInput = z.input<typeof stepOne> & z.input<typeof stepTwo> & z.input<typeof stepThree>;

/** Full server-side validation of a submission (all three steps). */
export function validateApplication(raw: unknown) {
  const r = raw as Record<string, unknown>;
  const a = stepOne.safeParse(r), b = stepTwo.safeParse(r), c = stepThree.safeParse(r);
  if (!a.success) return { ok: false as const, error: a.error.issues[0].message };
  if (!b.success) return { ok: false as const, error: b.error.issues[0].message };
  if (!c.success) return { ok: false as const, error: c.error.issues[0].message };
  return { ok: true as const, data: { ...a.data, ...b.data, ...c.data } };
}

/** Database error codes → wording for the applicant. Never reveals anything about other people. */
export const SUBMIT_ERRORS: Record<string, string> = {
  rate_limited: "We've had a lot of offers from this connection. Please try again later.",
  applications_closed: "The club isn't taking online offers of help right now. Please contact the club directly.",
  under_18: "This form is for adults. Please contact the club with a parent or carer.",
};
