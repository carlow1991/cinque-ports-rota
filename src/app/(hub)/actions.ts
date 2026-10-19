"use server";

import { refresh } from "next/cache";
import { requirePerson } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, friendlyError, type ActionResult } from "@/lib/actions/result";
import { readPreferences } from "@/lib/actions/hub-forms";
import { z } from "zod";

/** A member's own profile. The database only ever changes the caller's own record. */
export async function updateMyProfileAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePerson();
  const parsed = z.object({
    display_name: z.string().trim().max(80, "Names can be up to 80 characters."),
    phone: z.string().trim().max(30, "That phone number is too long."),
    contact_channels: z.array(z.enum(["email", "phone", "text", "whatsapp"], { message: "Choose from the listed ways to contact you." })).max(4),
  }).safeParse({
    display_name: fd.get("display_name") ?? "", phone: fd.get("phone") ?? "", contact_channels: [...new Set(fd.getAll("contact_channels").map(String))],
  });
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const sb = await createClient();
  const { error } = await sb.rpc("hub_update_my_profile", { p: {
    ...parsed.data,
    share_email_with_members: fd.get("share_email_with_members") === "on",
    share_phone_with_members: fd.get("share_phone_with_members") === "on",
  } });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Saved." };
}

export async function updateMyPreferencesAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const me = await requirePerson();
  const parsed = readPreferences(fd);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const sb = await createClient();
  const { error } = await sb.rpc("hub_set_preferences", { p_person_id: me.id, p: parsed.data });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Saved. This is a guide for organisers; it doesn't sign you up for anything." };
}
