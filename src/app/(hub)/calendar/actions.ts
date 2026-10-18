"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requirePerson } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyError, type ActionResult } from "@/lib/actions/result";
import { loadEvent } from "@/lib/data/hub-events";
import { timesOnEventDay } from "@/lib/domain/involvement";
import { isWallTime } from "@/lib/time/london";

/** A member's own replies. The database only ever records them for the signed-in person. */
const uuid = z.uuid();

export async function respondAvailabilityAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePerson();
  const id = uuid.safeParse(fd.get("event_id"));
  const response = z.enum(["yes", "no"]).safeParse(fd.get("response"));
  if (!id.success || !response.success) return fail("Choose Yes or No.");
  const whole = fd.get("when") !== "part";
  let from: string | null = null, until: string | null = null;
  if (response.data === "yes" && !whole) {
    const f = String(fd.get("from") ?? ""), u = String(fd.get("until") ?? "");
    if (!isWallTime(f) || !isWallTime(u)) return fail("Choose the times you're free, or “Whole event”.");
    const e = await loadEvent(id.data);
    if (!e) return fail("Not found.");
    const t = timesOnEventDay(e.starts_at, f, u);
    if (!t.ok) return fail(t.error);
    from = t.from.toISOString(); until = t.until.toISOString();
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_respond_availability", { p_event_id: id.data, p_response: response.data, p_full: whole, p_from: from, p_until: until });
  if (error) return fail(friendlyError(error));
  refresh();
  if (response.data === "no") return { ok: true, message: "Thanks — saved as can't help. You can change this any time." };
  const r = data as { needs_admin_check: boolean };
  return { ok: true, message: r.needs_admin_check
    ? "Thanks — saved. The finish time isn't recorded yet, so an organiser will check your times. This isn't a booking."
    : "Thanks — saved. This tells organisers you could help; it isn't a booking until they ask you and you accept." };
}

export async function respondAssignmentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePerson();
  const id = uuid.safeParse(fd.get("assignment_id"));
  if (!id.success) return fail("Not found.");
  const accept = fd.get("accept") === "yes";
  const sb = await createClient();
  const { error } = await sb.rpc("hub_respond_assignment", { p_assignment_id: id.data, p_accept: accept });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: accept ? "Confirmed — thank you!" : "Declined. The organiser can see your answer." };
}

export async function withdrawAssignmentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePerson();
  const id = uuid.safeParse(fd.get("assignment_id"));
  if (!id.success) return fail("Not found.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_withdraw_assignment", { p_assignment_id: id.data, p_reason: String(fd.get("reason") ?? "").slice(0, 500) || null });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Done — the organiser can see you can no longer help." };
}
