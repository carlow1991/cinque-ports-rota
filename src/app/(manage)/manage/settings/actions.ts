"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, friendlyError, type ActionResult } from "@/lib/actions/result";
import { kickOutbox } from "@/lib/email/server";

/** Admin-only reference data. RLS independently restricts every write to admins. */
const ADMIN = ["admin"] as const;
const text = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max);

async function done(r: { error: { message?: string; code?: string; details?: string | null } | null; count?: number | null }, msg: string): Promise<ActionResult> {
  if (r.error) return fail(friendlyError(r.error));
  if (r.count === 0) return fail("You don't have permission to change this.");
  refresh();
  return { ok: true, message: msg };
}

const venueSchema = z.object({
  name: text(1, 80, "Enter a venue name."),
  short_name: text(1, 30, "Enter a short name."),
  address: z.string().trim().max(300).optional(),
});

export async function saveVenueAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const parsed = venueSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const v = { ...parsed.data, address: parsed.data.address || null, active: fd.get("active") === "on" };
  const sb = await createClient();
  const id = fd.get("venue_id");
  if (typeof id === "string" && id) {
    return done(await sb.from("venues").update(v, { count: "exact" }).eq("id", id), "Venue saved.");
  }
  const code = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "venue";
  return done(await sb.from("venues").insert({ ...v, code: /^[a-z]/.test(code) ? code : `v_${code}`, active: true }, { count: "exact" }), "Venue added.");
}

export async function saveTeamAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const name = text(1, 80, "Enter a team name.").safeParse(fd.get("name"));
  if (!name.success) return fail(firstIssue(name.error.issues));
  const sb = await createClient();
  const id = fd.get("team_id");
  if (typeof id === "string" && id) {
    return done(await sb.from("teams").update({ name: name.data, active: fd.get("active") === "on" }, { count: "exact" }).eq("id", id), "Team saved.");
  }
  return done(await sb.from("teams").insert({ name: name.data }, { count: "exact" }), "Team added.");
}

const dutySchema = z.object({
  duty_id: z.uuid(),
  name: text(1, 80, "Enter a name."),
  description: z.string().trim().max(1000).optional(),
});

/** The nine duty codes are fixed (no add/delete); labels and the authorisation flag are editable. */
export async function saveDutyTypeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const parsed = dutySchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const sb = await createClient();
  return done(
    await sb.from("duty_types").update({
      name: parsed.data.name, description: parsed.data.description || null,
      requires_authorisation: fd.get("requires_authorisation") === "on", active: fd.get("active") === "on",
    }, { count: "exact" }).eq("id", parsed.data.duty_id),
    "Duty saved.",
  );
}

export async function saveClubSettingsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const h = z.coerce.number().int().min(0).max(336).safeParse(fd.get("withdrawal_cutoff_hours"));
  if (!h.success) return fail("The cut-off must be between 0 and 336 hours.");
  const sb = await createClient();
  return done(
    await sb.from("club_settings").update({ withdrawal_cutoff_hours: h.data, reminder_day_before: fd.get("reminder_day_before") === "on" }, { count: "exact" }).eq("id", 1),
    "Settings saved.",
  );
}

/** Put emails that failed in the last 7 days back in the queue (admin only; checked again in the database). */
export async function retryFailedEmailsAction(_p: ActionResult | null): Promise<ActionResult> {
  await requireRole(ADMIN);
  const sb = await createClient();
  const { data, error } = await sb.rpc("admin_retry_failed_emails");
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  const n = Number(data ?? 0);
  return { ok: true, message: n === 0 ? "There were no failed emails to retry." : `${n} email${n === 1 ? "" : "s"} queued to try again.` };
}
