"use server";

import { redirect } from "next/navigation";
import { requirePerson } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const VIEWS = ["list", "week", "month"] as const;
const KEEP = ["venue", "team", "type", "help", "inactive"] as const;

/**
 * Switch calendar view and remember it for this person (on their sign-in account, so it follows them to
 * any device). Saving the preference is best-effort: if it fails, the view still changes.
 */
export async function setCalendarViewAction(fd: FormData): Promise<void> {
  await requirePerson();
  const v = String(fd.get("view") ?? "");
  const view = (VIEWS as readonly string[]).includes(v) ? v : "list";
  const sb = await createClient();
  await sb.auth.updateUser({ data: { calendar_view: view } }).catch(() => null);
  const qs = new URLSearchParams({ view });
  for (const k of KEEP) {
    const x = fd.get(k);
    if (typeof x === "string" && x && x.length <= 64) qs.set(k, x);
  }
  redirect(`/calendar?${qs.toString()}`);
}
