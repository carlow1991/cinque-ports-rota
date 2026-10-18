import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Counts for "Needs attention" that come from club roles and (Stage 6) applications. */
export async function loadAttention(): Promise<{ new_applications: number; roles_recruiting: number }> {
  const sb = await createClient();
  const { data } = await sb.from("club_positions").select("seeking_replacement, seeking_additional_help").eq("active", true);
  const recruiting = (data ?? []).filter((p) => p.seeking_replacement || p.seeking_additional_help).length;
  return { new_applications: 0, roles_recruiting: recruiting };
}
