import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Volunteer Hub reads. Every query runs as the signed-in user, so RLS and the sanitised
 * SECURITY DEFINER functions decide what comes back. Errors throw (pages show the error panel).
 */
function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Couldn't load ${what}.`);
  return (r.data ?? ([] as unknown)) as T;
}

/** For maybeSingle(): no row is null, never an empty array. */
function mustOne<T>(r: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (r.error) throw new Error(`Couldn't load ${what}.`);
  return r.data ?? null;
}

export type DirectoryRow = {
  person_id: string; name: string; involvement: string[]; teams: { team: string; role: string }[]; positions: string[];
  email: string | null; phone: string | null; portal_status: string | null;
  routine_requests_enabled: boolean | null; lifecycle_status: string | null; is_under_18: boolean | null;
};

export async function loadDirectory(): Promise<DirectoryRow[]> {
  const sb = await createClient();
  return must(await sb.rpc("hub_directory"), "the directory");
}

export type Team = { id: string; name: string; active: boolean };
export async function loadTeams(): Promise<Team[]> {
  const sb = await createClient();
  return must(await sb.from("teams").select("id, name, active").order("name"), "teams");
}

export type Venue = { id: string; code: string; name: string; short_name: string; active: boolean; address: string | null };
export async function loadVenues(): Promise<Venue[]> {
  const sb = await createClient();
  return must(await sb.from("venues").select("id, code, name, short_name, active, address").order("name"), "venues");
}

export type PersonFull = {
  id: string; full_name: string; display_name: string | null; email_normalized: string | null; phone_normalized: string | null;
  preferred_contact_channel: string | null; lifecycle_status: string; routine_requests_enabled: boolean; involvement: string[];
  directory_visibility: string; share_email_with_members: boolean; share_phone_with_members: boolean; is_under_18: boolean;
  notes_private: string | null; created_at: string;
};
export type Account = {
  person_id: string; auth_user_id: string | null; access_level: "admin" | "coordinator" | "member"; enabled: boolean;
  invited_at: string | null; invite_state: string; last_invite_at: string | null; last_invite_error: string | null; linked_at: string | null;
};
export type TeamRole = { id: string; team_id: string; role_label: string; is_expected_by_default: boolean; active_from: string; active_to: string | null; teams: { name: string } | null };
export type Preferences = {
  commitment_bucket: string | null; commitment_pattern: string | null; location_preference: string | null; willing_to_learn: string | null;
  strengths: string[]; interests: string[]; free_text: string | null;
};
export type UsualSlot = { day_of_week: number; daypart: string };

const PERSON_COLS = "id, full_name, display_name, email_normalized, phone_normalized, preferred_contact_channel, lifecycle_status, routine_requests_enabled, involvement, directory_visibility, share_email_with_members, share_phone_with_members, is_under_18, notes_private, created_at";

/** Full record (admins, or the person themselves: RLS returns nothing otherwise). */
export async function loadPerson(id: string) {
  const sb = await createClient();
  const [p, acc, teams, prefs, slots, scopes, allTeams] = await Promise.all([
    sb.from("people").select(PERSON_COLS).eq("id", id).maybeSingle(),
    sb.from("user_accounts").select("person_id, auth_user_id, access_level, enabled, invited_at, invite_state, last_invite_at, last_invite_error, linked_at").eq("person_id", id).maybeSingle(),
    sb.from("team_people").select("id, team_id, role_label, is_expected_by_default, active_from, active_to").eq("person_id", id).order("active_from", { ascending: false }),
    sb.from("volunteer_preferences").select("commitment_bucket, commitment_pattern, location_preference, willing_to_learn, strengths, interests, free_text").eq("person_id", id).maybeSingle(),
    sb.from("usual_availability").select("day_of_week, daypart").eq("person_id", id),
    sb.from("coordinator_scopes").select("venue_id, team_id").eq("person_id", id),
    sb.from("teams").select("id, name"),
  ]);
  const teamName = new Map((must(allTeams, "teams") as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const person = mustOne(p, "the person") as PersonFull | null;
  return {
    person,
    account: mustOne(acc, "the account") as Account | null,
    teams: (must(teams, "team roles") as Omit<TeamRole, "teams">[]).map((r) => ({ ...r, teams: { name: teamName.get(r.team_id) ?? "Team" } })),
    prefs: normalisePrefs(mustOne(prefs, "preferences")),
    slots: must(slots, "usual availability") as UsualSlot[],
    scopes: must(scopes, "scopes") as { venue_id: string | null; team_id: string | null }[],
  };
}

export function portalStatusLabel(s: string | null | undefined): { label: string; tone: "neutral" | "info" | "good" | "warn" | "bad" } {
  switch (s) {
    case "active": return { label: "Portal active", tone: "good" };
    case "invited": return { label: "Invited", tone: "info" };
    case "invite_failed": return { label: "Invitation not sent — retry", tone: "bad" };
    case "invite_not_sent": return { label: "Invitation not sent", tone: "warn" };
    case "disabled": return { label: "Access disabled", tone: "neutral" };
    default: return { label: "Not invited", tone: "neutral" };
  }
}

function normalisePrefs(raw: unknown): Preferences | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Partial<Preferences>;
  return {
    commitment_bucket: r.commitment_bucket ?? null, commitment_pattern: r.commitment_pattern ?? null,
    location_preference: r.location_preference ?? null, willing_to_learn: r.willing_to_learn ?? null,
    strengths: Array.isArray(r.strengths) ? r.strengths : [], interests: Array.isArray(r.interests) ? r.interests : [],
    free_text: r.free_text ?? null,
  };
}

export type Position = {
  id: string; title: string; department: string | null; public_summary: string | null; responsibilities: string | null;
  estimated_commitment: string | null; work_location_preference: string | null; skills_required: string[]; skills_desirable: string[];
  interest_tags: string[]; training_available: boolean; requires_external_safeguarding_review: boolean; public_visible: boolean; active: boolean;
  seeking_replacement: boolean; seeking_additional_help: boolean; publish_vacancy: boolean;
  occupancy: "vacant" | "filled" | "shared"; public_reason: "successor" | "vacant" | "extra_help" | null;
  recruiting_contact: string | null; recruiting_contact_person_id: string | null;
  holders: { id: string | null; person_id: string; name: string; capacity: string; start_date: string | null }[];
  history: { id: string; name: string; capacity: string; start_date: string; end_date: string }[] | null;
  interests: { id: string; person_id: string | null; application_id: string | null; name: string | null; stage: string; note: string | null; updated_at: string }[] | null;
  my_interest: string | null;
};
export async function loadPositions(): Promise<Position[]> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_positions");
  if (error) throw new Error("Couldn't load club roles.");
  return (data ?? []) as Position[];
}
