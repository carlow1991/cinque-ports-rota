import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadApplicationCounts } from "@/lib/data/hub-applications";

/** Counts for "Needs attention" from club roles and applications (new + follow-ups due; 0 for non-admins). */
export async function loadAttention(): Promise<{ new_applications: number; roles_recruiting: number }> {
  const sb = await createClient();
  const { data } = await sb.from("club_positions").select("seeking_replacement, seeking_additional_help").eq("active", true);
  const recruiting = (data ?? []).filter((p) => p.seeking_replacement || p.seeking_additional_help).length;
  const apps = await loadApplicationCounts();
  return { new_applications: apps.new + apps.follow_up_due, roles_recruiting: recruiting };
}
