"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { HUB_ADMIN } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyError, type ActionResult } from "@/lib/actions/result";
import { isDateKey } from "@/lib/time/london";

/** Club roles: records for the club's own organisation. Nothing here is a formal club/FA appointment. */
const uuid = z.uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const list = (fd: FormData, k: string) => str(fd, k).split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 20);

export async function savePositionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = fd.get("position_id") ? uuid.safeParse(fd.get("position_id")) : null;
  if (id && !id.success) return fail("Not found.");
  const title = str(fd, "title");
  if (!title) return fail("Give the role a title.");
  const contact = str(fd, "recruiting_contact_person_id");
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_save_position", { p_id: id?.data ?? null, p: {
    title, department: str(fd, "department"), public_summary: str(fd, "public_summary"), responsibilities: str(fd, "responsibilities"),
    estimated_commitment: str(fd, "estimated_commitment"), work_location_preference: str(fd, "work_location_preference"),
    skills_required: list(fd, "skills_required"), skills_desirable: list(fd, "skills_desirable"), interest_tags: fd.getAll("interest_tags").map(String),
    training_available: fd.get("training_available") === "on", requires_external_safeguarding_review: fd.get("requires_external_safeguarding_review") === "on",
    public_visible: fd.get("public_visible") === "on", active: id ? fd.get("active") === "on" : true,
    recruiting_contact_person_id: uuid.safeParse(contact).success ? contact : null,
  } });
  if (error) return fail(friendlyError(error));
  if (!id) redirect(`/manage/club-roles/${data as string}`);
  refresh();
  return { ok: true, message: "Saved." };
}

export async function setRecruitingAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("position_id"));
  if (!id.success) return fail("Not found.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_set_recruiting", {
    p_position_id: id.data, p_seeking_replacement: fd.get("seeking_replacement") === "on",
    p_seeking_additional_help: fd.get("seeking_additional_help") === "on", p_publish_vacancy: fd.get("publish_vacancy") === "on",
  });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Recruiting saved. Current postholders are unchanged." };
}

export async function addHolderAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("position_id"));
  const person = uuid.safeParse(fd.get("person_id"));
  if (!id.success) return fail("Not found.");
  if (!person.success) return fail("Choose a person.");
  const start = str(fd, "start_date");
  if (start && !isDateKey(start)) return fail("Enter a valid start date.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_add_holder", { p_position_id: id.data, p_person_id: person.data, p_start: start || null,
    p_capacity: z.enum(["holder", "joint", "acting", "support"]).catch("holder").parse(fd.get("capacity")), p_note: str(fd, "note") || null });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Postholder added." };
}

export async function endHolderAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("holder_id"));
  if (!id.success) return fail("Not found.");
  const end = str(fd, "end_date");
  if (end && !isDateKey(end)) return fail("Enter a valid end date.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_end_holder", { p_holder_id: id.data, p_end: end || null });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Ended. It stays in the role's history." };
}

export async function setInterestAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = fd.get("interest_id") ? uuid.safeParse(fd.get("interest_id")) : null;
  const position = uuid.safeParse(fd.get("position_id"));
  const person = fd.get("person_id") ? uuid.safeParse(fd.get("person_id")) : null;
  if ((id && !id.success) || !position.success || (person && !person.success)) return fail("Not found.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_set_interest", { p_id: id?.data ?? null, p_position_id: position.data, p_person_id: person?.data ?? null,
    p_stage: str(fd, "stage") || "interested", p_note: str(fd, "note") || null });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Saved." };
}

export async function addSuggestedPositionsAction(_p: ActionResult | null): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_add_suggested_positions");
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: data ? `Added ${data} roles with no holders and nothing advertised. Add the current postholders next.` : "They're all here already." };
}
