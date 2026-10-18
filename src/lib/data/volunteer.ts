import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Volunteer data loaders. Everything comes from sanitised database functions that return only
 * the caller's own records and anonymous counts, never other volunteers' contact details.
 */

export type RotaEvent = {
  event_id: string; title: string; event_type: string; venue_id: string; venue_name: string; team_id: string | null;
  team_name: string | null; starts_at: string; ends_at: string; kickoff_at: string | null; opponent: string | null;
  is_demo: boolean; open_slots: number; eligible_open_slots: number; my_active_count: number;
};

export type VolunteerShift = {
  shift_id: string; duty_code: string; duty_name: string; duty_description: string | null; starts_at: string; ends_at: string;
  required_count: number; confirmed_count: number; pending_count: number; open_slots: number;
  signup_enabled: boolean; approval_required: boolean; instructions: string | null; responsibilities: string[];
  my_assignment_id: string | null; my_status: string | null; my_cancellation_pending: boolean;
  missing_authorisations: string[]; has_overlap: boolean; has_started: boolean;
};

export type MyDuty = {
  assignment_id: string; status: string; source: string; attendance_status: string; status_changed_at: string;
  removal_reason: string | null; event_id: string; event_title: string; event_status: string; event_status_reason: string | null;
  event_instructions: string | null; venue_name: string; venue_address: string | null; duty_name: string; responsibilities: string[];
  starts_at: string; ends_at: string; shift_status: string; shift_instructions: string | null; approval_required: boolean;
  cancellation_pending: boolean; withdraw_deadline: string; is_demo: boolean;
};

function must<T>(r: { data: unknown; error: unknown }, what: string): T {
  if (r.error) throw new Error(`Could not load ${what}.`);
  return (r.data ?? []) as T;
}

export async function loadRota(from: Date, to: Date, venueId?: string | null): Promise<RotaEvent[]> {
  const sb = await createClient();
  return must(await sb.rpc("volunteer_rota", { p_from: from.toISOString(), p_to: to.toISOString(), p_venue_id: venueId ?? null }), "the rota");
}

export async function loadVolunteerEvent(eventId: string) {
  const sb = await createClient();
  const ev = await sb.from("events")
    .select("id, venue_id, team_id, title, event_type, starts_at, ends_at, kickoff_at, opponent, competition, description, instructions, status, status_reason, is_demo")
    .eq("id", eventId).maybeSingle();
  if (ev.error) throw new Error("Could not load the event.");
  if (!ev.data) return null;
  const [shifts, roster, venue, team] = await Promise.all([
    sb.rpc("volunteer_event_view", { p_event_id: eventId }),
    sb.rpc("event_roster", { p_event_id: eventId }),
    sb.from("venues").select("name, address").eq("id", ev.data.venue_id).maybeSingle(),
    ev.data.team_id ? sb.from("teams").select("name").eq("id", ev.data.team_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  return {
    event: ev.data as {
      id: string; venue_id: string; team_id: string | null; title: string; event_type: string; starts_at: string; ends_at: string;
      kickoff_at: string | null; opponent: string | null; competition: string | null; description: string | null;
      instructions: string | null; status: string; status_reason: string | null; is_demo: boolean;
    },
    venue: (venue.data ?? null) as { name: string; address: string | null } | null,
    teamName: (team.data as { name: string } | null)?.name ?? null,
    shifts: must<VolunteerShift[]>(shifts, "duties"),
    roster: must<{ shift_id: string; display_name: string }[]>(roster, "who's going"),
  };
}

export type Opportunity = {
  shift_id: string; event_id: string; event_title: string; event_type: string; venue_name: string; team_name: string | null;
  duty_name: string; responsibilities: string[]; starts_at: string; ends_at: string; open_slots: number;
  approval_required: boolean; is_demo: boolean;
};

/** Duties the caller can take right now (same rules as the rota's "places you can take"). */
export async function loadOpportunities(from: Date, to: Date, limit = 6): Promise<Opportunity[]> {
  const sb = await createClient();
  return must(await sb.rpc("volunteer_opportunities", { p_from: from.toISOString(), p_to: to.toISOString(), p_limit: limit }), "duties you can take");
}

export async function loadMyDuties(): Promise<MyDuty[]> {
  const sb = await createClient();
  return must(await sb.rpc("my_duties"), "your duties");
}

/** The caller's duties plus the request time they were read at (for "upcoming" vs "past"). */
export async function loadMyDutiesNow(): Promise<{ duties: MyDuty[]; now: number }> {
  const duties = await loadMyDuties();
  return { duties, now: Date.now() };
}

export async function loadMyProfile(volunteerId: string) {
  const sb = await createClient();
  const [me, venues] = await Promise.all([
    sb.from("volunteers").select("display_name, email, phone, preferred_venue_id").eq("id", volunteerId).maybeSingle(),
    sb.from("venues").select("id, name").eq("active", true).order("name"),
  ]);
  if (me.error || venues.error) throw new Error("Could not load your profile.");
  return {
    me: me.data as { display_name: string; email: string; phone: string | null; preferred_venue_id: string | null },
    venues: (venues.data ?? []) as { id: string; name: string }[],
  };
}

export async function loadVenueAndTeamOptions() {
  const sb = await createClient();
  const [v, t] = await Promise.all([
    sb.from("venues").select("id, name").eq("active", true).order("name"),
    sb.from("teams").select("id, name").eq("active", true).order("name"),
  ]);
  return { venues: (v.data ?? []) as { id: string; name: string }[], teams: (t.data ?? []) as { id: string; name: string }[] };
}
