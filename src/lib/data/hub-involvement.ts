import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Involvement } from "@/lib/domain/involvement";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}, what = "this page"): Promise<T> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`Couldn't load ${what}.`);
  return data as T;
}

export const loadInvolvement = (eventId: string) => rpc<Involvement>("hub_event_involvement", { p_event_id: eventId }, "who's involved");

export type Candidate = { person_id: string; name: string; suggested: boolean; reason: string | null; already_asked: boolean; replied: string | null; has_account: boolean; has_email: boolean };
export const loadCandidates = (eventId: string) => rpc<Candidate[]>("hub_request_candidates", { p_event_id: eventId }, "people to ask");

export type PickerRow = { person_id: string; name: string; has_account: boolean; email: string | null; phone: string | null; routine: boolean };
export const loadPicker = () => rpc<PickerRow[]>("hub_people_picker", {}, "people");

type When = { begins_at: string | null; ends_at: string | null; event_starts_at: string | null; event_ends_at: string | null };
export type MyInvitation = When & { id: string; state: string; label: string | null; scope: "event" | "venue"; event_id: string | null; event_title: string | null; venue_id: string | null; external_location_text: string | null };
export type MyRequest = { event_id: string; title: string; starts_at: string; ends_at: string | null; kickoff_at: string | null; venue_id: string | null; external_location_text: string | null };
export type MyHome = { invitations: MyInvitation[]; requests: MyRequest[]; commitments: (MyInvitation & { response_source: string | null })[]; availability: { event_id: string; response: string }[] };
export const loadMyHome = () => rpc<MyHome>("hub_my_home", {}, "your home page");

export type OpenRequests = {
  invitations: { id: string; state: string; name: string; person_id: string; label: string | null; scope: string; event_id: string | null; event_title: string | null; starts_at: string; venue_id: string | null; invitation_source: string; created_at: string; phone: string | null; email: string | null }[];
  unanswered: { event_id: string; title: string; starts_at: string; asked: number; unanswered: number }[];
};
export const loadOpenRequests = () => rpc<OpenRequests>("hub_open_requests", {}, "requests");
