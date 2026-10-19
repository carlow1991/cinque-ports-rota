"use server";

import { refresh } from "next/cache";
import { kickOutbox } from "@/lib/email/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyError, type ActionResult } from "@/lib/actions/result";
import { eventWindow, shiftToDate } from "@/lib/domain/hub-calendar";
import { loadEvent } from "@/lib/data/hub-events";
import { isDateKey, isWallTime } from "@/lib/time/london";

/** Volunteer Hub event actions. Creating, editing or publishing an event never sends anything. */
const uuid = z.uuid();
const s = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");

function readEvent(fd: FormData): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  const title = s(fd, "title");
  if (!title) return { ok: false, error: "Give the event a name." };
  const date = s(fd, "date"), start = s(fd, "start"), end = s(fd, "end"), kickoff = s(fd, "kickoff");
  if (!isDateKey(date) || !isWallTime(start)) return { ok: false, error: "Enter a date and a start time." };
  if ((end && !isWallTime(end)) || (kickoff && !isWallTime(kickoff))) return { ok: false, error: "Enter times as hh:mm (24-hour)." };
  const w = eventWindow({ date, start, end: end || undefined, kickoff: kickoff || undefined });
  if (!w.ok) return { ok: false, error: w.error };
  const where = s(fd, "where");
  const outside = where === "outside";
  if (!outside && !uuid.safeParse(where).success) return { ok: false, error: "Choose where it is." };
  const ext = s(fd, "external_location_text");
  if (outside && !ext) return { ok: false, error: "Type the outside or away location." };
  const team = s(fd, "team_id");
  return { ok: true, payload: {
    title, category: s(fd, "category") || "other",
    starts_at: w.startsAt.toISOString(), ends_at: w.endsAt?.toISOString() ?? null, kickoff_at: w.kickoffAt?.toISOString() ?? null,
    venue_id: outside ? null : where, external_location_text: outside ? ext : null,
    team_id: uuid.safeParse(team).success ? team : null,
    volunteers_enabled: fd.get("volunteers_enabled") === "on",
    description: s(fd, "description"), opponent: s(fd, "opponent"), competition: s(fd, "competition"),
  } };
}

export async function createHubEventAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const r = readEvent(fd);
  if (!r.ok) return fail(r.error);
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_create_event", { p: { ...r.payload, status: fd.get("publish") === "on" ? "published" : "draft" } });
  if (error) return fail(friendlyError(error));
  redirect(`/manage/events/${data as string}?created=1`);
}

export async function updateHubEventAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("event_id"));
  if (!id.success) return fail("Not found.");
  const r = readEvent(fd);
  if (!r.ok) return fail(r.error);
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_update_event", { p_event_id: id.data, p: r.payload });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  const res = data as { material: boolean; reconfirm?: number };
  if (res.material && res.reconfirm) return { ok: true, message: `Saved. ${res.reconfirm} confirmed ${res.reconfirm === 1 ? "person needs" : "people need"} to reconfirm because the date, time or place changed. Nothing was sent automatically.` };
  return { ok: true, message: res.material ? "Saved. The date, time or place changed." : "Saved." };
}

export async function setHubEventStatusAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("event_id"));
  const status = z.enum(["published", "cancelled", "completed", "draft"]).safeParse(fd.get("status"));
  if (!id.success || !status.success) return fail("Not found.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_set_event_status", { p_event_id: id.data, p_status: status.data, p_reason: s(fd, "reason") || null });
  if (error) return fail(friendlyError(error));
  refresh();
  kickOutbox();
  const msg = { published: "Published. Members can see it; nothing was sent.", cancelled: "Cancelled. It stays on the calendar marked as cancelled.", completed: "Marked as completed.", draft: "Unpublished. Only organisers can see it now." };
  return { ok: true, message: msg[status.data] };
}

/** Copy as a new DRAFT on another date: same details, independent identity, no invitations, replies or cover. */
export async function copyHubEventAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("event_id"));
  const date = s(fd, "date");
  if (!id.success) return fail("Not found.");
  if (!isDateKey(date)) return fail("Choose the date for the copy.");
  const e = await loadEvent(id.data);
  if (!e) return fail("Not found.");
  const w = shiftToDate(e, date);
  if (!w.ok) return fail(w.error);
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_create_event", { p: {
    title: e.title, category: e.category, team_id: e.team_id, venue_id: e.venue_id, external_location_text: e.external_location_text,
    starts_at: w.startsAt.toISOString(), ends_at: w.endsAt?.toISOString() ?? null, kickoff_at: w.kickoffAt?.toISOString() ?? null,
    volunteers_enabled: e.volunteers_enabled, description: e.description, opponent: e.opponent, competition: e.competition, status: "draft",
  } });
  if (error) return fail(friendlyError(error));
  redirect(`/manage/events/${data as string}?created=copy`);
}
