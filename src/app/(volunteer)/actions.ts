"use server";

import { refresh } from "next/cache";
import { kickOutbox } from "@/lib/email/server";
import { z } from "zod";
import { requireVolunteer } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyError, type ActionResult } from "@/lib/actions/result";

/**
 * Volunteer actions. Each one re-checks the session, then calls a single atomic database function
 * that re-checks eligibility, capacity, overlaps and the cut-off inside one transaction.
 * A success message is returned only after the database has committed the change.
 */
const id = z.uuid();

async function call(fn: string, args: Record<string, unknown>, ok: (data: Record<string, unknown>) => string): Promise<ActionResult> {
  await requireVolunteer();
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  return { ok: true, message: ok((data ?? {}) as Record<string, unknown>), data: (data ?? {}) as Record<string, unknown> };
}

export async function signUpAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const s = id.safeParse(fd.get("shift_id"));
  if (!s.success) return fail("Duty not found.");
  return call("self_signup", { p_shift_id: s.data }, (d) =>
    d.status === "pending_approval"
      ? "Request sent. An organiser will approve it. Your place is held meanwhile."
      : "You're confirmed. Thank you!");
}

export async function acceptAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = id.safeParse(fd.get("assignment_id"));
  if (!a.success) return fail("Invitation not found.");
  return call("accept_invitation", { p_assignment_id: a.data }, (d) =>
    d.status === "pending_approval" ? "Accepted. An organiser still needs to approve it." : "Accepted. You're confirmed. Thank you!");
}

export async function declineAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = id.safeParse(fd.get("assignment_id"));
  if (!a.success) return fail("Invitation not found.");
  return call("decline_invitation", { p_assignment_id: a.data }, () => "Declined. Thanks for letting us know.");
}

export async function withdrawAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = id.safeParse(fd.get("assignment_id"));
  if (!a.success) return fail("Duty not found.");
  return call("withdraw_assignment", { p_assignment_id: a.data }, () => "You've been taken off this duty and the place is open again.");
}

export async function requestCancellationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = id.safeParse(fd.get("assignment_id"));
  if (!a.success) return fail("Duty not found.");
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500) || null;
  return call("request_cancellation", { p_assignment_id: a.data, p_reason: reason },
    () => "Request sent to the organisers. You're still down for this duty until they reply.");
}

const profileSchema = z.object({
  display_name: z.string().trim().min(1, "Enter your name.").max(80, "Keep your name under 80 characters."),
  phone: z.string().trim().max(30, "That phone number is too long.")
    .refine((v) => v === "" || /^[+0-9 ()-]{6,30}$/.test(v), "Use digits, spaces and + only."),
  preferred_venue_id: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()),
});

export async function updateProfileAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requireVolunteer();
  const parsed = profileSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form.");
  const sb = await createClient();
  // RLS limits this to the caller's own row; column grants limit it to these three fields.
  const { error, count } = await sb.from("volunteers")
    .update({ display_name: parsed.data.display_name, phone: parsed.data.phone || null, preferred_venue_id: parsed.data.preferred_venue_id }, { count: "exact" })
    .eq("id", me.id);
  if (error) return fail(friendlyError(error));
  if (!count) return fail("Your profile couldn't be saved. Please sign in again.");
  refresh();
  kickOutbox();
  return { ok: true, message: "Profile saved." };
}
