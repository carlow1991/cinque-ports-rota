"use server";

import { refresh } from "next/cache";
import { kickOutbox } from "@/lib/email/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { authInvitesEnabled, sendAuthInvite } from "@/lib/supabase/admin";
import { fail, firstIssue, friendlyError, type ActionResult } from "@/lib/actions/result";
import { londonToInstant } from "@/lib/time/london";

/** Volunteer administration: admins only. Each change is re-checked by a database function. */
const ADMIN = ["admin"] as const;
const ROLES = ["admin", "coordinator", "volunteer"] as const;

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email({ message: "Enter a valid email address." })),
  display_name: z.string().trim().min(1, "Enter their name.").max(80),
  role: z.enum(ROLES),
});

export async function inviteVolunteerAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const parsed = inviteSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const sb = await createClient();
  const { data, error } = await sb.rpc("admin_create_volunteer", {
    p_email: parsed.data.email, p_display_name: parsed.data.display_name, p_role: parsed.data.role,
  });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  const r = data as { already_linked: boolean; existing: boolean };
  if (r.already_linked) return { ok: true, message: `${parsed.data.display_name} already has an account and can sign in now.` };
  if (!authInvitesEnabled()) {
    return { ok: true, message: `${parsed.data.display_name} added. Invitation emails are switched off until the pilot is approved, so send it with scripts/invite-volunteer.mts.` };
  }
  const sent = await sendAuthInvite(parsed.data.email);
  if (sent === "sent") return { ok: true, message: `Invitation emailed to ${parsed.data.email}.` };
  if (sent === "already_registered") return { ok: true, message: `${parsed.data.display_name} is registered already and can sign in with their email.` };
  return fail(`${parsed.data.display_name} was added, but the invitation email couldn't be sent. Try again later.`);
}

export async function setAccessAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const id = z.uuid().safeParse(fd.get("volunteer_id"));
  const role = z.enum(ROLES).safeParse(fd.get("role"));
  if (!id.success || !role.success) return fail("Choose an access level.");
  const active = fd.get("is_active") === "on";
  const sb = await createClient();
  const { error } = await sb.rpc("admin_set_volunteer_access", { p_volunteer_id: id.data, p_role: role.data, p_is_active: active });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  return { ok: true, message: active ? "Access saved." : "Access saved. They are suspended and can no longer see anything." };
}

export async function setVenuesAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const id = z.uuid().safeParse(fd.get("volunteer_id"));
  if (!id.success) return fail("Not found.");
  const venues = fd.getAll("venue_ids").map(String).filter((x) => z.uuid().safeParse(x).success);
  const sb = await createClient();
  const { error } = await sb.rpc("admin_set_coordinator_venues", { p_volunteer_id: id.data, p_venue_ids: venues });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  return { ok: true, message: "Venues saved." };
}

const DUTY_CODES = ["site_lead", "open_unlock", "lock_secure", "gate_admissions", "refreshments", "pitch_setup", "facility_checks", "cleaning", "general_support"] as const;

export async function setAuthorisationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const id = z.uuid().safeParse(fd.get("volunteer_id"));
  const duty = z.enum(DUTY_CODES).safeParse(fd.get("duty_code"));
  if (!id.success || !duty.success) return fail("Not found.");
  const active = fd.get("active") === "on";
  const until = String(fd.get("valid_until") ?? "").trim();
  let validUntil: string | null = null;
  if (until) {
    // "Valid until" a UK date means through the end of that day.
    const end = londonToInstant(until, "23:59");
    if (!end.ok) return fail("Enter a valid date.");
    validUntil = end.instant.toISOString();
  }
  const sb = await createClient();
  const { error } = await sb.rpc("set_duty_authorisation", { p_volunteer_id: id.data, p_duty_code: duty.data, p_active: active, p_valid_until: validUntil });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  return { ok: true, message: "Authorisation saved." };
}
