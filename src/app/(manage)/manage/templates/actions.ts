"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, friendlyError, type ActionResult } from "@/lib/actions/result";
import { offsetFromParts, sampleTimes } from "@/lib/domain/template-timing";

/** Template administration: admins only (re-checked here and again in the database). */
const ADMIN = ["admin"] as const;
const anchor = z.enum(["event_start", "event_end"]);
const DUTY_CODES = ["site_lead", "open_unlock", "lock_secure", "gate_admissions", "refreshments", "pitch_setup", "facility_checks", "cleaning", "general_support"] as const;

const itemSchema = z.object({
  item_id: z.uuid(),
  required_count: z.coerce.number().int().min(1, "At least 1 person.").max(50),
  // Readable form: "45 minutes | before | the event starts". Stored as a signed offset (negative = before).
  start_anchor: anchor,
  start_minutes: z.coerce.number().int().min(0).max(1440, "At most 24 hours (1440 minutes)."),
  start_dir: z.enum(["before", "after"]),
  end_anchor: anchor,
  end_minutes: z.coerce.number().int().min(0).max(1440, "At most 24 hours (1440 minutes)."),
  end_dir: z.enum(["before", "after"]),
  when_to_enable: z.string().max(500).optional(),
  instructions: z.string().max(2000).optional(),
});

export async function updateTemplateItemAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const parsed = itemSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const v = parsed.data;
  const startOffset = offsetFromParts(v.start_minutes, v.start_dir);
  const endOffset = offsetFromParts(v.end_minutes, v.end_dir);
  if (!sampleTimes(v.start_anchor, startOffset, v.end_anchor, endOffset).ok) return fail("This duty would end before it starts. Check the times.");
  const sb = await createClient();
  const { error } = await sb.rpc("admin_update_template_item", {
    p_item_id: v.item_id, p_required_count: v.required_count, p_enabled_by_default: fd.get("enabled_by_default") === "on",
    p_start_anchor: v.start_anchor, p_start_offset: startOffset, p_end_anchor: v.end_anchor, p_end_offset: endOffset,
    p_suppressed: fd.get("suppressed") === "on", p_signup_enabled: fd.get("signup_enabled") === "on",
    p_approval_required: fd.get("approval_required") === "on", p_when_to_enable: v.when_to_enable ?? null,
    p_instructions: v.instructions ?? null,
    p_responsibilities: fd.getAll("responsibilities").map(String).filter((c) => (DUTY_CODES as readonly string[]).includes(c)),
  });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Duty saved. New events will use it; existing duties keep their current times." };
}

export async function addTemplateItemAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const t = z.uuid().safeParse(fd.get("template_id"));
  const d = z.enum(DUTY_CODES).safeParse(fd.get("duty_code"));
  if (!t.success || !d.success) return fail("Choose a duty.");
  const sb = await createClient();
  const { error } = await sb.rpc("admin_add_template_item", { p_template_id: t.data, p_duty_code: d.data });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Duty added (switched off by default). Set its times below." };
}

export async function deleteTemplateItemAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const id = z.uuid().safeParse(fd.get("item_id"));
  if (!id.success) return fail("Duty not found.");
  const sb = await createClient();
  // Events already generated keep their duties (event_shifts.source_template_item_id is set null).
  const { error, count } = await sb.from("duty_template_items").delete({ count: "exact" }).eq("id", id.data);
  if (error) return fail(friendlyError(error));
  if (!count) return fail("You don't have permission to change templates.");
  refresh();
  return { ok: true, message: "Removed from the template. Existing events are not changed." };
}

const templateSchema = z.object({
  template_id: z.uuid(),
  name: z.string().trim().min(1, "Give the template a name.").max(120),
  description: z.string().max(2000).optional(),
});

export async function updateTemplateAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(ADMIN);
  const parsed = templateSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const sb = await createClient();
  const { error, count } = await sb.from("duty_templates")
    .update({ name: parsed.data.name, description: parsed.data.description?.trim() || null, active: fd.get("active") === "on" }, { count: "exact" })
    .eq("id", parsed.data.template_id);
  if (error) return fail(friendlyError(error));
  if (!count) return fail("You don't have permission to change templates.");
  refresh();
  return { ok: true, message: "Name and description saved. Duties are saved separately." };
}
