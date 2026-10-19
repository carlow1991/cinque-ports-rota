import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Application = {
  id: string; linked_person_id: string | null; full_name: string; email_normalized: string | null; phone_normalized: string | null;
  contact_preference: string; existing_club_connection: string | null; heard_from: string | null; interests: string[];
  selected_position_ids: string[]; unsure_role: boolean; strengths: string[]; experience_text: string | null; willing_to_learn: string | null;
  availability: { day: number; daypart: string }[]; availability_varies: boolean; commitment_bucket: string | null; commitment_pattern: string | null;
  work_location_preference: string | null; free_notes: string | null; privacy_notice_version: string; privacy_acknowledged_at: string;
  communication_opt_in: boolean; stage: string; duplicate_review_status: string; duplicate_candidates: { kind: "person" | "application"; id: string; match: string }[];
  last_contacted_at: string | null; follow_up_on: string | null; admin_notes: string | null; created_at: string; retention_review_at: string | null;
};
export type Suggestion = { club_position_id: string; score: number; reasons: string[]; needs_checks: boolean };

const COLS = "id, linked_person_id, full_name, email_normalized, phone_normalized, contact_preference, existing_club_connection, heard_from, interests, selected_position_ids, unsure_role, strengths, experience_text, willing_to_learn, availability, availability_varies, commitment_bucket, commitment_pattern, work_location_preference, free_notes, privacy_notice_version, privacy_acknowledged_at, communication_opt_in, stage, duplicate_review_status, duplicate_candidates, last_contacted_at, follow_up_on, admin_notes, created_at, retention_review_at";

export async function loadApplications(): Promise<Application[]> {
  const sb = await createClient();
  const { data, error } = await sb.from("volunteer_applications").select(COLS).order("created_at", { ascending: false });
  if (error) throw new Error("Couldn't load applications.");
  return (data ?? []) as Application[];
}

export async function loadApplication(id: string) {
  const sb = await createClient();
  const [a, s] = await Promise.all([
    sb.from("volunteer_applications").select(COLS).eq("id", id).maybeSingle(),
    sb.from("application_role_suggestions").select("club_position_id, score, reasons, needs_checks").eq("application_id", id).order("score", { ascending: false }),
  ]);
  if (a.error || s.error) throw new Error("Couldn't load the application.");
  return { app: (a.data ?? null) as Application | null, suggestions: (s.data ?? []) as Suggestion[] };
}

/** Directory rows for possible duplicates (admins read people directly through RLS). */
export async function loadPeopleByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const sb = await createClient();
  const { data, error } = await sb.from("people").select("id, full_name, display_name, email_normalized, phone_normalized, lifecycle_status").in("id", ids);
  if (error) throw new Error("Couldn't load people.");
  return (data ?? []) as { id: string; full_name: string; display_name: string | null; email_normalized: string | null; phone_normalized: string | null; lifecycle_status: string }[];
}

export async function loadApplicationCounts(): Promise<{ new: number; follow_up_due: number; retention_due: number }> {
  const sb = await createClient();
  const { data } = await sb.rpc("hub_application_counts");
  return (data ?? { new: 0, follow_up_due: 0, retention_due: 0 }) as { new: number; follow_up_due: number; retention_due: number };
}

export const STAGES = [
  { code: "new", label: "New" }, { code: "reviewing", label: "In review" }, { code: "contacted", label: "Contacted" },
  { code: "trial", label: "Trial / shadowing" }, { code: "accepted_to_pool", label: "Accepted into pool" }, { code: "closed", label: "Closed" },
] as const;
