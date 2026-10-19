"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { HUB_ADMIN } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyError, type ActionResult } from "@/lib/actions/result";
import { isDateKey } from "@/lib/time/london";

/** Application review. None of these create a login, send an invitation or appoint anyone. */
const uuid = z.uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function updateApplicationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("application_id"));
  if (!id.success) return fail("Not found.");
  const follow = str(fd, "follow_up_on");
  if (follow && !isDateKey(follow)) return fail("Enter a valid follow-up date.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_update_application", { p_id: id.data, p: {
    stage: str(fd, "stage"), follow_up_on: follow, admin_notes: str(fd, "admin_notes"), contacted_now: fd.get("contacted_now") === "on",
    ...(fd.get("not_duplicate") === "on" ? { duplicate_review_status: "not_duplicate" } : {}),
  } });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Saved." };
}

export async function linkApplicationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("application_id"));
  const person = uuid.safeParse(fd.get("person_id"));
  if (!id.success || !person.success) return fail("Choose who to link to.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_link_application", { p_id: id.data, p_person_id: person.data });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Linked. Their existing record wasn't changed." };
}

export async function createPersonFromApplicationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("application_id"));
  if (!id.success) return fail("Not found.");
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_create_person_from_application", { p_id: id.data, p_routine: fd.get("routine") === "on" });
  if (error) return fail(friendlyError(error));
  redirect(`/manage/people/${data as string}?done=saved`);
}

export async function matchPositionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("application_id"));
  const pos = uuid.safeParse(fd.get("position_id"));
  if (!id.success || !pos.success) return fail("Choose a role.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_match_application_position", { p_id: id.data, p_position_id: pos.data });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Added to that role's interest list. This isn't an appointment." };
}

export async function deleteApplicationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("application_id"));
  if (!id.success) return fail("Not found.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_delete_application", { p_id: id.data });
  if (error) return fail(friendlyError(error));
  redirect("/manage/applications?deleted=1");
}
