import { z } from "zod";
import { COMMITMENT_BUCKETS, COMMITMENT_PATTERNS, DAYPARTS, INTEREST_CODES, LOCATION_PREFS, STRENGTH_CODES } from "@/lib/domain/hub-tags";

/** Shared FormData → validated payloads for Hub actions. The database validates again. */
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

export const personSchema = z.object({
  full_name: z.string().min(1, "Enter a name.").max(120, "Names can be up to 120 characters."),
  display_name: z.string().max(80).optional(),
  email: z.union([z.literal(""), z.string().max(254).pipe(z.email({ message: "Enter a valid email address, or leave it blank." }))]),
  phone: z.string().max(30, "That phone number is too long."),
  preferred_contact_channel: z.enum(["", "email", "phone", "whatsapp"]),
  involvement: z.array(z.enum(["volunteer", "manager", "official", "other"])),
  routine_requests_enabled: z.boolean(),
  directory_visibility: z.enum(["members", "private"]),
  share_email_with_members: z.boolean(),
  share_phone_with_members: z.boolean(),
  is_under_18: z.boolean(),
  notes_private: z.string().max(2000),
  lifecycle_status: z.enum(["active", "inactive", "applicant"]).optional(),
});

export function readPerson(fd: FormData) {
  return personSchema.safeParse({
    full_name: str(fd, "full_name"),
    display_name: str(fd, "display_name") || undefined,
    email: str(fd, "email").toLowerCase(),
    phone: str(fd, "phone"),
    preferred_contact_channel: str(fd, "preferred_contact_channel"),
    involvement: fd.getAll("involvement").map(String),
    routine_requests_enabled: bool(fd, "routine_requests_enabled"),
    directory_visibility: str(fd, "directory_visibility") === "private" ? "private" : "members",
    share_email_with_members: bool(fd, "share_email_with_members"),
    share_phone_with_members: bool(fd, "share_phone_with_members"),
    is_under_18: bool(fd, "is_under_18"),
    notes_private: str(fd, "notes_private"),
    lifecycle_status: (str(fd, "lifecycle_status") || undefined) as "active" | undefined,
  });
}

const codes = (list: readonly { code: string }[]) => list.map((x) => x.code) as [string, ...string[]];

export const preferencesSchema = z.object({
  interests: z.array(z.string()).max(40).transform((a) => a.filter((x) => INTEREST_CODES.includes(x))),
  strengths: z.array(z.string()).max(20).transform((a) => a.filter((x) => STRENGTH_CODES.includes(x))),
  commitment_bucket: z.union([z.literal(""), z.enum(codes(COMMITMENT_BUCKETS))]),
  commitment_pattern: z.union([z.literal(""), z.enum(codes(COMMITMENT_PATTERNS))]),
  location_preference: z.union([z.literal(""), z.enum(codes(LOCATION_PREFS))]),
  willing_to_learn: z.enum(["", "yes", "maybe", "no"]),
  free_text: z.string().max(1000),
  usual_availability: z.array(z.object({ day: z.number().int().min(0).max(6), daypart: z.enum(codes(DAYPARTS)) })).max(21),
});

export function readPreferences(fd: FormData) {
  const slots = fd.getAll("slot").map(String).flatMap((s) => {
    const m = /^([0-6])-(morning|afternoon|evening)$/.exec(s);
    return m ? [{ day: Number(m[1]), daypart: m[2] }] : [];
  });
  return preferencesSchema.safeParse({
    interests: fd.getAll("interests").map(String),
    strengths: fd.getAll("strengths").map(String),
    commitment_bucket: str(fd, "commitment_bucket"),
    commitment_pattern: str(fd, "commitment_pattern"),
    location_preference: str(fd, "location_preference"),
    willing_to_learn: str(fd, "willing_to_learn"),
    free_text: str(fd, "free_text"),
    usual_availability: slots,
  });
}
