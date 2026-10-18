import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { HubEvent } from "@/lib/domain/hub-calendar";

const EVENT_COLS = "id, title, category, status, starts_at, ends_at, kickoff_at, venue_id, external_location_text, team_id, volunteers_enabled, description, opponent, competition, cancel_reason, organiser_person_id, is_demo";

/** Events visible to the caller (RLS: members see non-drafts; organisers also their drafts). */
export async function loadEventsBetween(from: Date, to: Date): Promise<HubEvent[]> {
  const sb = await createClient();
  const { data, error } = await sb.from("events").select(EVENT_COLS)
    .gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at");
  if (error) throw new Error("Couldn't load events.");
  return (data ?? []) as HubEvent[];
}

export async function loadEvent(id: string): Promise<HubEvent | null> {
  const sb = await createClient();
  const { data, error } = await sb.from("events").select(EVENT_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error("Couldn't load the event.");
  return (data ?? null) as HubEvent | null;
}

export type Names = { venues: Map<string, { name: string; active: boolean }>; teams: Map<string, string> };
export async function loadNames(): Promise<Names> {
  const sb = await createClient();
  const [v, t] = await Promise.all([sb.from("venues").select("id, name, active"), sb.from("teams").select("id, name")]);
  if (v.error || t.error) throw new Error("Couldn't load venues and teams.");
  return {
    venues: new Map((v.data ?? []).map((x) => [x.id as string, { name: x.name as string, active: x.active as boolean }])),
    teams: new Map((t.data ?? []).map((x) => [x.id as string, x.name as string])),
  };
}

export function placeName(e: Pick<HubEvent, "venue_id" | "external_location_text">, names: Names): string {
  if (e.venue_id) return names.venues.get(e.venue_id)?.name ?? "Venue";
  return e.external_location_text ?? "Location to be confirmed";
}
