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

export type VenueCoverRow = {
  id: string; person_id: string; name: string; venue_id: string; label: string | null; begins_at: string; ends_at: string;
  state: string; response_source: string | null; can_manage: boolean; conflict_override_note: string | null; phone: string | null; events: number;
};
export const loadVenueCovers = (from: Date, to: Date) =>
  rpc<VenueCoverRow[]>("hub_venue_covers", { p_from: from.toISOString(), p_to: to.toISOString() }, "venue cover");

export type CoverPreview = { events: { id: string; title: string; starts_at: string; ends_at: string | null; status: string; coverage: string }[]; conflicts: { what: string; where: string; starts_at: string; ends_at: string }[] };
export const loadCoverPreview = (venueId: string, from: Date, to: Date, personId: string | null) =>
  rpc<CoverPreview>("hub_venue_cover_preview", { p_venue_id: venueId, p_begins: from.toISOString(), p_ends: to.toISOString(), p_person_id: personId }, "the preview");

export type EventCounts = { confirmed: number; expected: number; available: number; pending: number; unanswered: number };
export type Overview = {
  events: { id: string; title: string; starts_at: string; ends_at: string | null; kickoff_at: string | null; venue_id: string | null; external_location_text: string | null;
    team_id: string | null; status: string; volunteers_enabled: boolean; category: string; is_demo: boolean; counts: EventCounts }[];
  days: { day: string; people: number }[];
  drafts: number;
  needs_check: { event_id: string; title: string; name: string }[];
};
export const loadOverview = (from: Date, to: Date) => rpc<Overview>("hub_manage_overview", { p_from: from.toISOString(), p_to: to.toISOString() }, "the overview");
