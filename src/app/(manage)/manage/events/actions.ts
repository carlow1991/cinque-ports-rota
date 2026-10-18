"use server";

import { refresh } from "next/cache";
import { kickOutbox } from "@/lib/email/server";
import { notifyOutcome } from "@/lib/email/state";
import { loadMessagingState } from "@/lib/email/state-server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, friendlyError, ORGANISER_WORDING, type ActionResult } from "@/lib/actions/result";
import { londonToInstant, londonWindow } from "@/lib/time/london";

/**
 * Organiser event actions. Every action: (1) re-checks the caller on the server,
 * (2) validates input with zod, (3) converts UK wall times to instants once, and
 * (4) calls a narrow database function that re-checks permission and rules itself.
 * UI hiding is never relied on.
 */

const uuid = z.uuid({ message: "Choose an option." });
const optUuid = z.preprocess((v) => (v === "" || v == null ? null : v), z.uuid().nullable());
const optText = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max).optional().transform((v) => v || null));
const EVENT_TYPES = ["fixture", "training", "meeting", "maintenance", "fundraising", "club_event", "venue_coverage", "other"] as const;
const DUTY_CODES = ["site_lead", "open_unlock", "lock_secure", "gate_admissions", "refreshments", "pitch_setup", "facility_checks", "cleaning", "general_support"] as const;

function window(date: unknown, start: unknown, end: unknown) {
  return londonWindow(String(date ?? ""), String(start ?? ""), String(end ?? ""));
}

/** Read per-item headcount overrides named "count_<itemId>" for enabled items only. */
function counts(fd: FormData, enabled: string[]) {
  const out: Record<string, number> = {};
  for (const id of enabled) {
    const raw = fd.get(`count_${id}`);
    if (raw == null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 50) return null;
    out[id] = n;
  }
  return out;
}

// ---------------------------------------------------------------------------
const createSchema = z.object({
  venue_id: uuid,
  event_type: z.enum(EVENT_TYPES),
  title: z.string().trim().min(1, "Give the event a title.").max(120),
  team_id: optUuid,
  opponent: optText(120),
  competition: optText(120),
  description: optText(4000),
  instructions: optText(4000),
  coverage_event_id: optUuid,
  template_id: optUuid,
});

export async function createEventAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const parsed = createSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const v = parsed.data;

  const w = window(fd.get("date"), fd.get("start"), fd.get("end"));
  if (!w.ok) return fail(w.error);
  let kickoff: string | null = null;
  const ko = String(fd.get("kickoff") ?? "").trim();
  if (ko) {
    const k = londonToInstant(String(fd.get("date")), ko);
    if (!k.ok) return fail("Enter a valid kick-off time.");
    kickoff = k.instant.toISOString();
  }
  const enabled = fd.getAll("enabled").map(String).filter((x) => z.uuid().safeParse(x).success);
  const c = counts(fd, enabled);
  if (!c) return fail("Each duty needs between 1 and 50 volunteers.");

  const sb = await createClient();
  const { data, error } = await sb.rpc("create_event", {
    p_venue_id: v.venue_id,
    p_title: v.title,
    p_event_type: v.event_type,
    p_starts_at: w.startsAt.toISOString(),
    p_ends_at: w.endsAt.toISOString(),
    p_team_id: v.team_id,
    p_kickoff_at: kickoff,
    p_opponent: v.opponent,
    p_competition: v.competition,
    p_description: v.description,
    p_instructions: v.instructions,
    p_coverage_event_id: v.coverage_event_id,
    p_site_responsibility: fd.get("site_responsibility") === "on",
    p_template_id: v.template_id,
    p_enabled: v.template_id ? enabled : null,
    p_counts: v.template_id ? c : {},
  });
  if (error) return fail(friendlyError(error));
  redirect(`/manage/events/${(data as { event_id: string }).event_id}?created=1`);
}

// ---------------------------------------------------------------------------
export async function publishEventAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const id = uuid.safeParse(fd.get("event_id"));
  if (!id.success) return fail("Event not found.");
  const sb = await createClient();
  const { error } = await sb.rpc("publish_event", { p_event_id: id.data });
  if (error) return fail(friendlyError(error));
  // The Publish panel disappears once published, so confirm on the page itself.
  redirect(`/manage/events/${id.data}?published=1`);
}

const detailsSchema = z.object({
  event_id: uuid,
  title: z.string().trim().min(1, "Give the event a title.").max(120),
  team_id: optUuid,
  opponent: optText(120),
  competition: optText(120),
  description: optText(4000),
  instructions: optText(4000),
});

export async function updateDetailsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const parsed = detailsSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const { event_id, ...v } = parsed.data;
  let kickoff: string | null = null;
  const ko = String(fd.get("kickoff") ?? "").trim();
  if (ko) {
    const k = londonToInstant(String(fd.get("kickoff_date") ?? ""), ko);
    if (!k.ok) return fail("Enter a valid kick-off time.");
    kickoff = k.instant.toISOString();
  }
  const sb = await createClient();
  // Direct update: RLS limits it to the caller's venues and column grants to descriptive fields.
  const { error, count } = await sb.from("events")
    .update({ ...v, kickoff_at: kickoff, site_responsibility: fd.get("site_responsibility") === "on" }, { count: "exact" })
    .eq("id", event_id);
  if (error) return fail(friendlyError(error));
  if (count === 0) return fail("You don't have permission to edit this event.");
  refresh();
  kickOutbox();
  return { ok: true, message: "Details saved." };
}

export async function rescheduleAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const id = uuid.safeParse(fd.get("event_id"));
  if (!id.success) return fail("Event not found.");
  const w = window(fd.get("date"), fd.get("start"), fd.get("end"));
  if (!w.ok) return fail(w.error);
  const sb = await createClient();
  const { data, error } = await sb.rpc("reschedule_event", {
    p_event_id: id.data, p_starts_at: w.startsAt.toISOString(), p_ends_at: w.endsAt.toISOString(),
  });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  const n = (data as { assignments_reset: number }).assignments_reset;
  // Leave the review step: the event page shows what was saved and how many must reconfirm.
  redirect(`/manage/events/${id.data}?tab=changes&saved=${n}`);
}

// ---------------------------------------------------------------------------
const shiftSchema = z.object({
  event_id: uuid,
  duty_code: z.enum(DUTY_CODES, { message: "Choose a duty." }),
  required_count: z.coerce.number().int().min(1, "At least 1 volunteer.").max(50),
  instructions: optText(2000),
});

export async function addShiftAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const parsed = shiftSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const w = window(fd.get("date"), fd.get("start"), fd.get("end"));
  if (!w.ok) return fail(w.error);
  const resp = fd.getAll("responsibilities").map(String).filter((c) => (DUTY_CODES as readonly string[]).includes(c));
  const sb = await createClient();
  const { error } = await sb.rpc("add_shift", {
    p_event_id: parsed.data.event_id, p_duty_code: parsed.data.duty_code,
    p_starts_at: w.startsAt.toISOString(), p_ends_at: w.endsAt.toISOString(), p_required_count: parsed.data.required_count,
    p_signup_enabled: fd.get("signup_enabled") === "on", p_approval_required: fd.get("approval_required") === "on",
    p_instructions: parsed.data.instructions, p_responsibilities: resp,
  });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  return { ok: true, message: "Duty added." };
}

export async function updateShiftAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const id = uuid.safeParse(fd.get("shift_id"));
  const n = z.coerce.number().int().min(1).max(50).safeParse(fd.get("required_count"));
  if (!id.success) return fail("Duty not found.");
  if (!n.success) return fail("Each duty needs between 1 and 50 volunteers.");
  const w = window(fd.get("date"), fd.get("start"), fd.get("end"));
  if (!w.ok) return fail(w.error);
  const sb = await createClient();
  const { data, error } = await sb.rpc("update_shift", {
    p_shift_id: id.data, p_starts_at: w.startsAt.toISOString(), p_ends_at: w.endsAt.toISOString(), p_required_count: n.data,
    p_signup_enabled: fd.get("signup_enabled") === "on", p_approval_required: fd.get("approval_required") === "on",
  });
  if (error) return fail(friendlyError(error));
  const instructions = String(fd.get("instructions") ?? "").trim().slice(0, 2000) || null;
  await sb.from("event_shifts").update({ instructions }).eq("id", id.data);
  refresh();
  kickOutbox();
  const reset = (data as { assignments_reset: number }).assignments_reset;
  return { ok: true, message: reset ? `Saved. ${reset} volunteer(s) asked to reconfirm the new times.` : "Saved." };
}

export async function cancelShiftAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const MAIL = await loadMessagingState();
  await requireRole(MANAGER_ROLES);
  const id = uuid.safeParse(fd.get("shift_id"));
  const reason = String(fd.get("reason") ?? "").trim();
  if (!id.success) return fail("Duty not found.");
  if (!reason) return fail("Please give a reason.");
  const sb = await createClient();
  const { error } = await sb.rpc("cancel_shift", { p_shift_id: id.data, p_reason: reason.slice(0, 500) });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  return { ok: true, message: `Duty removed. ${notifyOutcome(MAIL, "anyone who was on it", true)}` };
}

// ---------------------------------------------------------------------------
export async function linkCoverAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const id = uuid.safeParse(fd.get("event_id"));
  const cover = optUuid.safeParse(fd.get("coverage_event_id"));
  if (!id.success || !cover.success) return fail("Choose a venue-cover event.");
  const sb = await createClient();
  const { data, error } = await sb.rpc("link_venue_cover", { p_event_id: id.data, p_coverage_event_id: cover.data });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  const r = data as { duplicate_duties_removed: number; duplicate_duties_kept: number };
  if (!cover.data) return { ok: true, message: "Unlinked. This event now needs its own site lead or another cover decision." };
  const parts = ["Linked to venue-wide cover."];
  if (r.duplicate_duties_removed) parts.push(`${r.duplicate_duties_removed} duplicate site-lead duty removed.`);
  if (r.duplicate_duties_kept) parts.push(`${r.duplicate_duties_kept} site-lead duty kept because someone is already on it. Remove it from the duty list if it's no longer needed.`);
  return { ok: true, message: parts.join(" ") };
}

export async function applyTemplateAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const id = uuid.safeParse(fd.get("event_id"));
  const tpl = uuid.safeParse(fd.get("template_id"));
  if (!id.success || !tpl.success) return fail("Choose a template.");
  const enabled = fd.getAll("enabled").map(String).filter((x) => z.uuid().safeParse(x).success);
  const c = counts(fd, enabled);
  if (!c) return fail("Each duty needs between 1 and 50 volunteers.");
  const sb = await createClient();
  const { data, error } = await sb.rpc("apply_template", { p_event_id: id.data, p_template_id: tpl.data, p_enabled: enabled, p_counts: c });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  const n = (data as { shifts_created: number }).shifts_created;
  return { ok: true, message: n ? `${n} duty(ies) added.` : "No new duties: those chosen are already on the event." };
}

export async function setSiteCoverAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const id = uuid.safeParse(fd.get("event_id"));
  const source = z.enum(["club_volunteer", "provider_verified", "not_required"]).safeParse(fd.get("source"));
  if (!id.success || !source.success) return fail("Choose an option.");
  const sb = await createClient();
  const { error } = await sb.rpc("set_site_cover", {
    p_event_id: id.data, p_source: source.data, p_note: String(fd.get("note") ?? "").trim().slice(0, 1000) || null,
  });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  return { ok: true, message: "Site-cover decision recorded." };
}

// ---------------------------------------------------------------------------
// Phase 5: people on duties, attendance, postpone / cancel / complete
// ---------------------------------------------------------------------------
async function rpcAction(fn: string, args: Record<string, unknown>, message: string | ((d: Record<string, unknown>) => string)): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return fail(friendlyError(error, undefined, ORGANISER_WORDING));
  refresh();
  kickOutbox();
  return { ok: true, message: typeof message === "string" ? message : message((data ?? {}) as Record<string, unknown>) };
}
const reasonOf = (fd: FormData) => String(fd.get("reason") ?? "").trim().slice(0, 500);

export async function allocateAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const MAIL = await loadMessagingState();
  const s = uuid.safeParse(fd.get("shift_id"));
  const v = uuid.safeParse(fd.get("volunteer_id"));
  if (!s.success || !v.success) return fail("Choose a volunteer.");
  return rpcAction("allocate_volunteer", { p_shift_id: s.data, p_volunteer_id: v.data },
    `Invited. It counts only once they accept. ${notifyOutcome(MAIL, "the volunteer")}`);
}

export async function approveAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const MAIL = await loadMessagingState();
  const a = uuid.safeParse(fd.get("assignment_id"));
  if (!a.success) return fail("Not found.");
  return rpcAction("approve_assignment", { p_assignment_id: a.data }, `Approved. They're confirmed. ${notifyOutcome(MAIL, "the volunteer")}`);
}

export async function rejectAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const MAIL = await loadMessagingState();
  const a = uuid.safeParse(fd.get("assignment_id"));
  if (!a.success) return fail("Not found.");
  return rpcAction("reject_assignment", { p_assignment_id: a.data, p_reason: reasonOf(fd) || null }, `Declined. The place is free again. ${notifyOutcome(MAIL, "the volunteer")}`);
}

export async function removeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const MAIL = await loadMessagingState();
  const a = uuid.safeParse(fd.get("assignment_id"));
  if (!a.success) return fail("Not found.");
  const reason = reasonOf(fd);
  if (!reason) return fail("Please give a reason. The volunteer will see it.");
  return rpcAction("remove_assignment", { p_assignment_id: a.data, p_reason: reason }, `Removed. The place is open again. ${notifyOutcome(MAIL, "the volunteer")}`);
}

export async function resolveCancellationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const MAIL = await loadMessagingState();
  const r = uuid.safeParse(fd.get("request_id"));
  if (!r.success) return fail("Not found.");
  const approve = fd.get("decision") === "approve";
  return rpcAction("resolve_cancellation_request", { p_request_id: r.data, p_approve: approve },
    `${approve ? "Cancellation accepted. The place is open again." : "Cancellation declined. They're still on the duty."} ${notifyOutcome(MAIL, "the volunteer")}`);
}

export async function attendanceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = uuid.safeParse(fd.get("assignment_id"));
  const s = z.enum(["present", "absent", "not_recorded"]).safeParse(fd.get("attendance"));
  if (!a.success || !s.success) return fail("Not found.");
  return rpcAction("mark_attendance", { p_assignment_id: a.data, p_attendance: s.data }, "Attendance saved.");
}

export async function postponeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const MAIL = await loadMessagingState();
  const e = uuid.safeParse(fd.get("event_id"));
  if (!e.success) return fail("Event not found.");
  if (!reasonOf(fd)) return fail("Please give a reason. Volunteers will see it.");
  return rpcAction("postpone_event", { p_event_id: e.data, p_reason: reasonOf(fd) }, (d) =>
    `Postponed. ${d.assignments_reset ?? 0} volunteer(s) need to reconfirm. ${notifyOutcome(MAIL, "them", true)} Set the new date, then publish again.`);
}

export async function cancelEventAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const MAIL = await loadMessagingState();
  const e = uuid.safeParse(fd.get("event_id"));
  if (!e.success) return fail("Event not found.");
  if (!reasonOf(fd)) return fail("Please give a reason. Volunteers will see it.");
  return rpcAction("cancel_event", { p_event_id: e.data, p_reason: reasonOf(fd) }, (d) =>
    `Cancelled. ${d.assignments_cancelled ?? 0} volunteer(s) taken off; reminders stopped. ${notifyOutcome(MAIL, "them", true)}`);
}

export async function completeEventAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const e = uuid.safeParse(fd.get("event_id"));
  if (!e.success) return fail("Event not found.");
  return rpcAction("complete_event", { p_event_id: e.data }, "Marked as completed.");
}

/** Split a site-lead duty into two handover duties that meet exactly at the chosen time. */
export async function splitSiteLeadAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(MANAGER_ROLES);
  const id = uuid.safeParse(fd.get("shift_id"));
  if (!id.success) return fail("Duty not found.");
  const at = londonToInstant(String(fd.get("date") ?? ""), String(fd.get("time") ?? ""));
  if (!at.ok) return fail("Enter a valid handover date and time.");
  const sb = await createClient();
  const { error } = await sb.rpc("split_site_lead_shift", { p_shift_id: id.data, p_at: at.instant.toISOString() });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Split into two handover duties. Fill both to keep continuous cover." };
}
