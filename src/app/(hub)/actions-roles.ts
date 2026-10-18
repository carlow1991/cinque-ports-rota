"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requirePerson } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { fail, friendlyError, type ActionResult } from "@/lib/actions/result";

export async function registerInterestAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePerson();
  const id = z.uuid().safeParse(fd.get("position_id"));
  if (!id.success) return fail("Not found.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_register_interest", { p_position_id: id.data, p_note: String(fd.get("note") ?? "").slice(0, 1000) || null });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Thanks — the club will be in touch about this role." };
}
