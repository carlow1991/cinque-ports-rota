"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireLevel } from "@/lib/auth/dal";
import { HUB_ADMIN } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, friendlyError, type ActionResult } from "@/lib/actions/result";
import { kickOutbox } from "@/lib/email/server";
import { messagingState } from "@/lib/email/state";

/** Admin-only reference data. RLS independently restricts every write to admins. */
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
  await requireLevel(HUB_ADMIN);
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
  await requireLevel(HUB_ADMIN);
  const parsed = z.object({
    name: text(1, 80, "Enter a team name."),
    league: z.string().trim().max(80, "League names can be up to 80 characters."),
    division: z.string().trim().max(60, "Division names can be up to 60 characters."),
  }).safeParse({ name: fd.get("name"), league: fd.get("league") ?? "", division: fd.get("division") ?? "" });
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const team = { name: parsed.data.name, league: parsed.data.league || null, division: parsed.data.division || null };
  const sb = await createClient();
  const id = fd.get("team_id");
  if (typeof id === "string" && id) {
    return done(await sb.from("teams").update({ ...team, active: fd.get("active") === "on" }, { count: "exact" }).eq("id", id), "Team saved.");
  }
  return done(await sb.from("teams").insert(team, { count: "exact" }), "Team added.");
}

const dutySchema = z.object({
  duty_id: z.uuid(),
  name: text(1, 80, "Enter a name."),
  description: z.string().trim().max(1000).optional(),
});

/** The nine duty codes are fixed (no add/delete); labels and the authorisation flag are editable. */
export async function saveDutyTypeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
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
  await requireLevel(HUB_ADMIN);
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
  await requireLevel(HUB_ADMIN);
  const sb = await createClient();
  const { data, error } = await sb.rpc("admin_retry_failed_emails");
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  const n = Number(data ?? 0);
  return { ok: true, message: n === 0 ? "There were no failed emails to retry." : `${n} email${n === 1 ? "" : "s"} queued to try again.` };
}

/**
 * Start or pause email (the database release switch). Starting is only allowed once the hosting
 * switch is on and configured, so messages can't pile up and then all go later.
 */
export async function setEmailReleaseAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const mode = z.enum(["new_only", "include_current", "pause"]).safeParse(fd.get("mode"));
  if (!mode.success) return fail("Choose an option.");
  const env = messagingState();
  if (mode.data !== "pause" && env !== "on" && env !== "limited") {
    return fail("Switch on email sending in the hosting settings first (and check it is set up). Starting here before then would let messages pile up and all go later.");
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc("admin_set_email_release", { p_mode: mode.data });
  if (error) return fail(friendlyError(error));
  refresh();
  if (mode.data !== "pause") kickOutbox();
  // The start/pause form is replaced by the other one after saving, so report on the page itself.
  const d = (data ?? {}) as { suppressed_out_of_date?: number; held_back?: number };
  redirect(mode.data === "pause" ? "/manage/settings?email=paused#email"
    : `/manage/settings?email=started&held=${d.held_back ?? 0}&dropped=${d.suppressed_out_of_date ?? 0}#email`);
}

/** Club details and Hub switches (contact email, applications open, retention, reminders). */
export async function saveHubSettingsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const months = String(fd.get("application_retention_months") ?? "").trim();
  if (months && !/^\d{1,3}$/.test(months)) return fail("Enter a number of months, or leave it blank.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_save_settings", { p: {
    contact_email: String(fd.get("contact_email") ?? "").trim(), applications_open: fd.get("applications_open") === "on",
    application_retention_months: months, reminder_day_before: fd.get("reminder_day_before") === "on",
  } });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Settings saved." };
}
