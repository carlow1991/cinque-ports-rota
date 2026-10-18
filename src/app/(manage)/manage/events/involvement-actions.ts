"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyError, type ActionResult } from "@/lib/actions/result";
import { loadEvent } from "@/lib/data/hub-events";
import { timesOnEventDay } from "@/lib/domain/involvement";
import { isWallTime } from "@/lib/time/london";

/**
 * Organiser actions on one event. Each is deliberate: nothing is sent unless the organiser presses
 * Send / Send request; "Record…" actions save what someone said offline, attributed to the organiser.
 */
const uuid = z.uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function optionalTimes(eventId: string, fd: FormData, a = "from", b = "until") {
  const f = str(fd, a), u = str(fd, b);
  if (!f && !u) return { ok: true as const, from: null, until: null };
  if (!isWallTime(f) || !isWallTime(u)) return { ok: false as const, error: "Enter both times (hh:mm), or leave both blank." };
  const e = await loadEvent(eventId);
  if (!e) return { ok: false as const, error: "Not found." };
  const t = timesOnEventDay(e.starts_at, f, u);
  if (!t.ok) return { ok: false as const, error: t.error };
  return { ok: true as const, from: t.from.toISOString(), until: t.until.toISOString() };
}

export async function requestAvailabilityAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("event_id"));
  if (!id.success) return fail("Not found.");
  const people = fd.getAll("person_ids").map(String).filter((x) => uuid.safeParse(x).success);
  if (people.length === 0) return fail("Tick at least one person to ask.");
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_request_availability", { p_event_id: id.data, p_person_ids: people });
  if (error) return fail(friendlyError(error));
  refresh();
  const r = data as { requested: number; already_asked: number };
  const again = r.already_asked ? ` ${r.already_asked} had already been asked and weren't asked again.` : "";
  return { ok: true, message: `Asked ${r.requested} ${r.requested === 1 ? "person" : "people"}. They'll see it on their Home page.${again}` };
}

export async function inviteToHelpAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("event_id"));
  const person = uuid.safeParse(fd.get("person_id"));
  if (!id.success) return fail("Not found.");
  if (!person.success) return fail("Choose a person.");
  const mode = fd.get("mode") === "record_confirmed" ? "record_confirmed" : "request";
  const t = await optionalTimes(id.data, fd);
  if (!t.ok) return fail(t.error);
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_invite_to_help", {
    p_event_id: id.data, p_person_id: person.data, p_label: str(fd, "label") || null, p_begins: t.from, p_ends: t.until, p_mode: mode,
  });
  if (error) return fail(friendlyError(error));
  refresh();
  const r = data as { status: string; has_account?: boolean };
  if (r.status.startsWith("already_")) return { ok: true, message: `They already have this request (${r.status.replace("already_", "").replace("_", " ")}). Nothing new was sent.` };
  if (r.status === "recorded_confirmed") return { ok: true, message: "Recorded as confirmed by you (agreed offline)." };
  return { ok: true, message: r.has_account
    ? "Request saved. They'll see it on their Home page and can accept or decline. They aren't confirmed until they accept."
    : "Request saved as pending. They don't use the Hub, so contact them yourself, then use “Record their answer”." };
}

export async function recordAvailabilityAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("event_id"));
  const person = uuid.safeParse(fd.get("person_id"));
  const response = z.enum(["yes", "no"]).safeParse(fd.get("response"));
  if (!id.success) return fail("Not found.");
  if (!person.success || !response.success) return fail("Choose a person and their answer.");
  const t = await optionalTimes(id.data, fd);
  if (!t.ok) return fail(t.error);
  const sb = await createClient();
  const { error } = await sb.rpc("hub_record_availability", {
    p_event_id: id.data, p_person_id: person.data, p_response: response.data, p_full: t.from === null, p_from: t.from, p_until: t.until,
  });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Recorded. It shows as “Recorded by” you, not as their own reply." };
}

export async function recordAssignmentResponseAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("assignment_id"));
  if (!id.success) return fail("Not found.");
  const accept = fd.get("accept") === "yes";
  const sb = await createClient();
  const { error } = await sb.rpc("hub_record_assignment_response", { p_assignment_id: id.data, p_accept: accept });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: accept ? "Recorded as confirmed by you." : "Recorded as declined." };
}

export async function cancelAssignmentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("assignment_id"));
  if (!id.success) return fail("Not found.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_cancel_assignment", { p_assignment_id: id.data, p_reason: str(fd, "reason") || null });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Cancelled." };
}

export async function expectedOverrideAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("event_id"));
  const person = uuid.safeParse(fd.get("person_id"));
  if (!id.success || !person.success) return fail("Not found.");
  const raw = str(fd, "override");
  const override = raw === "not_expected" || raw === "confirmed_by_admin" ? raw : null;
  const sb = await createClient();
  const { error } = await sb.rpc("hub_set_expected_override", { p_event_id: id.data, p_person_id: person.data, p_override: override, p_note: str(fd, "note") || null });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: override === "not_expected" ? "Marked as not expected for this event only." : override ? "Recorded as attending." : "Back to expected by role." };
}

export async function markContactedAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("event_id"));
  const person = uuid.safeParse(fd.get("person_id"));
  if (!id.success || !person.success) return fail("Not found.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_mark_request_contacted", { p_event_id: id.data, p_person_id: person.data });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Noted that you contacted them another way." };
}
