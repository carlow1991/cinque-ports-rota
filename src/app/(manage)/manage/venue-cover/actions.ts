"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyError, type ActionResult } from "@/lib/actions/result";
import { eventWindow } from "@/lib/domain/hub-calendar";
import { isDateKey, isWallTime } from "@/lib/time/london";

/** One venue-wide assignment per real duty/person/time. Events show it as context; it is edited only here. */
const uuid = z.uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function window(fd: FormData) {
  const date = str(fd, "date"), from = str(fd, "from"), until = str(fd, "until");
  if (!isDateKey(date) || !isWallTime(from) || !isWallTime(until)) return { ok: false as const, error: "Enter the date and both times." };
  const w = eventWindow({ date, start: from, end: until });
  if (!w.ok) return { ok: false as const, error: w.error };
  return { ok: true as const, from: w.startsAt.toISOString(), until: w.endsAt!.toISOString() };
}

export async function createCoverAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const venue = uuid.safeParse(fd.get("venue_id"));
  const person = uuid.safeParse(fd.get("person_id"));
  if (!venue.success) return fail("Choose a venue.");
  if (!person.success) return fail("Choose a person.");
  const w = window(fd);
  if (!w.ok) return fail(w.error);
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_create_venue_cover", {
    p_venue_id: venue.data, p_person_id: person.data, p_begins: w.from, p_ends: w.until, p_label: str(fd, "label") || null,
    p_mode: fd.get("mode") === "record_confirmed" ? "record_confirmed" : "request", p_override_note: str(fd, "override_note") || null,
  });
  if (error) return fail(friendlyError(error));
  refresh();
  const r = data as { status: string; has_account?: boolean };
  if (r.status === "already_exists") return { ok: true, message: "That cover is already arranged. Nothing new was saved or sent." };
  if (r.status === "recorded_confirmed") return { ok: true, message: "Saved as confirmed (agreed offline). It now shows on every event it overlaps." };
  return { ok: true, message: r.has_account ? "Request saved. It shows on events once they accept." : "Saved as pending. They don't use the Hub: contact them, then record their answer." };
}

export async function updateCoverAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_MANAGERS);
  const id = uuid.safeParse(fd.get("assignment_id"));
  if (!id.success) return fail("Not found.");
  const w = window(fd);
  if (!w.ok) return fail(w.error);
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_update_venue_cover", {
    p_assignment_id: id.data, p_begins: w.from, p_ends: w.until, p_label: str(fd, "label") || null,
    p_agreed: fd.get("agreed") === "on", p_override_note: str(fd, "override_note") || null,
  });
  if (error) return fail(friendlyError(error));
  refresh();
  const r = data as { state: string };
  return { ok: true, message: r.state === "needs_reconfirmation"
    ? "Saved. Because the times changed, they need to reconfirm before it counts as cover."
    : "Saved. Every overlapping event now shows the new times." };
}
