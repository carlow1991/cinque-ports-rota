import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TemplateItem } from "@/lib/domain/templates";

/**
 * Organiser data loaders. All queries run as the signed-in user, so RLS decides what comes back.
 * Callers must have passed requireRole(MANAGER_ROLES) first. Deliberately simple queries
 * (no embedded joins): relations are stitched together here.
 */

export type Venue = { id: string; code: string; name: string; short_name: string; address: string | null; active: boolean };
export type Team = { id: string; name: string; active: boolean };
export type DutyType = { id: string; code: string; name: string; description: string | null; requires_authorisation: boolean; active: boolean; sort_order: number };
export type Template = { id: string; code: string; name: string; description: string | null; event_type: string; venue_id: string | null; active: boolean; items: TemplateItem[] };

export type OverviewRow = {
  event_id: string; title: string; event_type: string; status: string; is_demo: boolean; venue_id: string; venue_name: string;
  team_name: string | null; starts_at: string; ends_at: string; kickoff_at: string | null; coverage_event_id: string | null;
  shift_rows: number; required_slots: number; confirmed: number; pending: number; invited: number; open_slots: number; cover_state: string | null;
};

function must<T>(r: { data: T | null; error: unknown }, what: string): T {
  if (r.error) throw new Error(`Could not load ${what}.`);
  return (r.data ?? ([] as unknown)) as T;
}

export async function loadVenues(): Promise<Venue[]> {
  const sb = await createClient();
  return must(await sb.from("venues").select("id, code, name, short_name, address, active").order("name"), "venues");
}

export async function loadManagedVenueIds(isAdmin: boolean, volunteerId: string): Promise<string[] | "all"> {
  if (isAdmin) return "all";
  const sb = await createClient();
  const rows = must<{ venue_id: string }[]>(await sb.from("coordinator_venues").select("venue_id").eq("volunteer_id", volunteerId), "venue access");
  return rows.map((r) => r.venue_id);
}

export async function loadTeams(): Promise<Team[]> {
  const sb = await createClient();
  return must(await sb.from("teams").select("id, name, active").order("name"), "teams");
}

export async function loadDutyTypes(): Promise<DutyType[]> {
  const sb = await createClient();
  return must(await sb.from("duty_types").select("id, code, name, description, requires_authorisation, active, sort_order").order("sort_order"), "duties");
}

export async function loadTemplates(opts: { includeInactive?: boolean } = {}): Promise<Template[]> {
  const sb = await createClient();
  let q = sb.from("duty_templates").select("id, code, name, description, event_type, venue_id, active").order("code");
  if (!opts.includeInactive) q = q.eq("active", true);
  const templates = must<Omit<Template, "items">[]>(await q, "templates");
  if (templates.length === 0) return [];
  const [items, resp, duties] = await Promise.all([
    sb.from("duty_template_items")
      .select("id, template_id, sort_order, duty_type_id, required_count, enabled_by_default, when_to_enable, start_anchor, start_offset_minutes, end_anchor, end_offset_minutes, suppressed_by_linked_cover, signup_enabled, approval_required, instructions")
      .in("template_id", templates.map((t) => t.id))
      .order("sort_order"),
    sb.from("template_item_responsibilities").select("template_item_id, duty_type_id"),
    loadDutyTypes(),
  ]);
  const dutyById = new Map(duties.map((d) => [d.id, d]));
  const respByItem = new Map<string, { code: string; name: string }[]>();
  for (const r of must<{ template_item_id: string; duty_type_id: string }[]>(resp, "template duties")) {
    const d = dutyById.get(r.duty_type_id);
    if (!d) continue;
    const list = respByItem.get(r.template_item_id) ?? [];
    list.push({ code: d.code, name: d.name });
    respByItem.set(r.template_item_id, list);
  }
  type ItemRow = {
    id: string; template_id: string; sort_order: number; duty_type_id: string; required_count: number; enabled_by_default: boolean;
    when_to_enable: string | null; start_anchor: TemplateItem["startAnchor"]; start_offset_minutes: number; end_anchor: TemplateItem["endAnchor"];
    end_offset_minutes: number; suppressed_by_linked_cover: boolean; signup_enabled: boolean; approval_required: boolean; instructions: string | null;
  };
  const byTemplate = new Map<string, TemplateItem[]>();
  for (const i of must<ItemRow[]>(items, "template duties")) {
    const d = dutyById.get(i.duty_type_id);
    const list = byTemplate.get(i.template_id) ?? [];
    list.push({
      id: i.id, sortOrder: i.sort_order, dutyCode: d?.code ?? "?", dutyName: d?.name ?? "Unknown duty",
      requiredCount: i.required_count, enabledByDefault: i.enabled_by_default, whenToEnable: i.when_to_enable,
      startAnchor: i.start_anchor, startOffsetMinutes: i.start_offset_minutes, endAnchor: i.end_anchor, endOffsetMinutes: i.end_offset_minutes,
      suppressedByLinkedCover: i.suppressed_by_linked_cover, signupEnabled: i.signup_enabled, approvalRequired: i.approval_required,
      instructions: i.instructions,
      responsibilities: (respByItem.get(i.id) ?? []).sort((a, b) => (dutyByCode(duties, a.code) - dutyByCode(duties, b.code))),
    });
    byTemplate.set(i.template_id, list);
  }
  return templates.map((t) => ({ ...t, items: byTemplate.get(t.id) ?? [] }));
}

function dutyByCode(duties: DutyType[], code: string) {
  return duties.find((d) => d.code === code)?.sort_order ?? 99;
}

export async function loadOverview(from: Date, to: Date, venueId?: string | null): Promise<OverviewRow[]> {
  const sb = await createClient();
  const r = await sb.rpc("manage_events_overview", { p_from: from.toISOString(), p_to: to.toISOString(), p_venue_id: venueId ?? null });
  return must<OverviewRow[]>(r, "events");
}

export type NextEvent = { id: string; title: string; venue_id: string; starts_at: string; status: string };

/**
 * The next event (draft or published) starting at or after `after`, limited to the venues this
 * organiser manages. Used only to make empty states useful ("next scheduled: …"). RLS still
 * applies; the venue filter keeps a coordinator's hint to their own venues.
 */
export async function loadNextEvent(after: Date, venueIds: string[] | "all"): Promise<NextEvent | null> {
  if (venueIds !== "all" && venueIds.length === 0) return null;
  const sb = await createClient();
  let q = sb.from("events").select("id, title, venue_id, starts_at, status")
    .in("status", ["draft", "published"]).gte("starts_at", after.toISOString());
  if (venueIds !== "all") q = q.in("venue_id", venueIds);
  const r = await q.order("starts_at").limit(1);
  return must<NextEvent[]>(r, "next event")[0] ?? null;
}

export type CoverageOption = { id: string; title: string; venue_id: string; starts_at: string; ends_at: string; status: string };

export async function loadCoverageEvents(from: Date, to: Date): Promise<CoverageOption[]> {
  const sb = await createClient();
  const r = await sb.from("events").select("id, title, venue_id, starts_at, ends_at, status")
    .eq("event_type", "venue_coverage").neq("status", "cancelled").neq("status", "completed")
    .lt("starts_at", to.toISOString()).gt("ends_at", from.toISOString()).order("starts_at");
  return must(r, "venue cover events");
}

export type EventRow = {
  id: string; venue_id: string; team_id: string | null; coverage_event_id: string | null; title: string; event_type: string;
  starts_at: string; ends_at: string; kickoff_at: string | null; opponent: string | null; competition: string | null;
  description: string | null; instructions: string | null; status: string; status_reason: string | null; site_responsibility: boolean;
  site_cover_source: string; external_cover_note: string | null; is_demo: boolean;
};
export type ShiftView = {
  id: string; duty_type_id: string; duty_code: string; duty_name: string; starts_at: string; ends_at: string; required_count: number;
  signup_enabled: boolean; approval_required: boolean; instructions: string | null; source_template_item_id: string | null;
  responsibilities: { code: string; name: string }[];
  confirmed: number; pending: number; invited: number | null; open: number;
};
export type Coverage = { state: string; coverage_event_id: string | null; required_window: string; gaps: string } | null;

export async function loadEvent(id: string) {
  const sb = await createClient();
  const ev = await sb.from("events")
    .select("id, venue_id, team_id, coverage_event_id, title, event_type, starts_at, ends_at, kickoff_at, opponent, competition, description, instructions, status, status_reason, site_responsibility, site_cover_source, external_cover_note, is_demo")
    .eq("id", id).maybeSingle();
  if (ev.error) throw new Error("Could not load the event.");
  if (!ev.data) return null;
  const event = ev.data as EventRow;

  const [shiftsR, staffingR, coverageR, duties] = await Promise.all([
    sb.from("event_shifts").select("id, duty_type_id, starts_at, ends_at, required_count, signup_enabled, approval_required, instructions, source_template_item_id")
      .eq("event_id", id).eq("status", "active").order("starts_at"),
    sb.rpc("event_shift_staffing", { p_event_id: id }),
    sb.rpc("event_site_coverage", { p_event_id: id }),
    loadDutyTypes(),
  ]);
  type S = { id: string; duty_type_id: string; starts_at: string; ends_at: string; required_count: number; signup_enabled: boolean; approval_required: boolean; instructions: string | null; source_template_item_id: string | null };
  const shifts = must<S[]>(shiftsR, "duties");
  const respR = shifts.length
    ? await sb.from("event_shift_responsibilities").select("shift_id, duty_type_id").in("shift_id", shifts.map((s) => s.id))
    : { data: [], error: null };
  const dutyById = new Map(duties.map((d) => [d.id, d]));
  const staffing = new Map(
    must<{ shift_id: string; confirmed_count: number; pending_count: number; invited_count: number | null; open_slots: number }[]>(staffingR, "staffing")
      .map((s) => [s.shift_id, s]),
  );
  const resp = must<{ shift_id: string; duty_type_id: string }[]>(respR, "included duties");

  const shiftViews: ShiftView[] = shifts.map((s) => {
    const d = dutyById.get(s.duty_type_id);
    const st = staffing.get(s.id);
    return {
      ...s,
      duty_code: d?.code ?? "?",
      duty_name: d?.name ?? "Unknown duty",
      responsibilities: resp.filter((r) => r.shift_id === s.id)
        .map((r) => dutyById.get(r.duty_type_id)).filter((x): x is DutyType => Boolean(x))
        .sort((a, b) => a.sort_order - b.sort_order).map((x) => ({ code: x.code, name: x.name })),
      confirmed: st?.confirmed_count ?? 0,
      pending: st?.pending_count ?? 0,
      invited: st?.invited_count ?? null,
      open: st?.open_slots ?? s.required_count,
    };
  });

  const coverage = (must<NonNullable<Coverage>[]>(coverageR, "venue cover")[0] ?? null) as Coverage;
  return { event, shifts: shiftViews, coverage, duties };
}

export async function loadLinkedEvents(coverageEventId: string) {
  const sb = await createClient();
  return must<{ id: string; title: string; starts_at: string; ends_at: string; status: string }[]>(
    await sb.from("events").select("id, title, starts_at, ends_at, status").eq("coverage_event_id", coverageEventId).order("starts_at"),
    "linked events",
  );
}

export async function loadClubSettings() {
  const sb = await createClient();
  const r = await sb.from("club_settings").select("withdrawal_cutoff_hours, reminder_day_before, timezone").maybeSingle();
  if (r.error) throw new Error("Could not load settings.");
  return r.data as { withdrawal_cutoff_hours: number; reminder_day_before: boolean; timezone: string } | null;
}

// ---------------------------------------------------------------------------
// Phase 5: rosters, action queue, site-lead names, allocation picker
// ---------------------------------------------------------------------------
export type RosterRow = {
  event_id: string; event_title: string; event_type: string; event_status: string; is_demo: boolean;
  venue_id: string; venue_name: string; team_name: string | null; event_starts_at: string; event_ends_at: string;
  shift_id: string; duty_code: string; duty_name: string; responsibilities: string[];
  shift_starts_at: string; shift_ends_at: string; required_count: number; approval_required: boolean; signup_enabled: boolean;
  shift_instructions: string | null;
  assignment_id: string | null; volunteer_id: string | null; display_name: string | null; phone: string | null;
  status: "invited" | "pending_approval" | "confirmed" | null; source: string | null; attendance_status: string | null;
  status_changed_at: string | null; cancellation_request_id: string | null; cancellation_reason: string | null;
};

export async function loadRoster(opts: { eventId?: string; from?: Date; to?: Date; venueId?: string | null }): Promise<RosterRow[]> {
  const sb = await createClient();
  const r = await sb.rpc("manage_roster", {
    p_from: opts.from?.toISOString() ?? null, p_to: opts.to?.toISOString() ?? null,
    p_venue_id: opts.venueId ?? null, p_event_id: opts.eventId ?? null,
  });
  return must<RosterRow[]>(r, "the roster");
}

export type QueueRow = {
  kind: "approval" | "invitation" | "cancellation"; assignment_id: string; request_id: string | null; event_id: string;
  event_title: string; venue_name: string; duty_name: string; shift_starts_at: string; shift_ends_at: string;
  display_name: string; reason: string | null; since: string;
};

export async function loadActionQueue(): Promise<QueueRow[]> {
  const sb = await createClient();
  return must<QueueRow[]>(await sb.rpc("manage_action_queue"), "the action list");
}

export type CoverLead = { source: "this_event" | "linked_cover"; event_id: string; event_title: string; shift_id: string; starts_at: string; ends_at: string; display_name: string | null; status: string | null; authorised: boolean | null; cancellation_requested: boolean | null };

export async function loadCoverLeads(eventId: string): Promise<CoverLead[]> {
  const sb = await createClient();
  return must<CoverLead[]>(await sb.rpc("event_cover_leads", { p_event_id: eventId }), "site leads");
}

export type PickerRow = { volunteer_id: string; display_name: string; eligible: boolean; missing_authorisations: string[]; has_overlap: boolean };

export async function loadPicker(shiftId: string): Promise<PickerRow[]> {
  const sb = await createClient();
  return must<PickerRow[]>(await sb.rpc("volunteer_picker", { p_shift_id: shiftId }), "volunteers");
}

export async function loadShiftForAssign(shiftId: string) {
  const sb = await createClient();
  const s = await sb.from("event_shifts").select("id, event_id, duty_type_id, starts_at, ends_at, required_count, status").eq("id", shiftId).maybeSingle();
  if (s.error) throw new Error("Could not load the duty.");
  if (!s.data) return null;
  const [ev, duty, staffing] = await Promise.all([
    sb.from("events").select("id, title, venue_id, status, starts_at, ends_at").eq("id", s.data.event_id).maybeSingle(),
    sb.from("duty_types").select("name").eq("id", s.data.duty_type_id).maybeSingle(),
    sb.rpc("event_shift_staffing", { p_event_id: s.data.event_id }),
  ]);
  if (!ev.data) return null;
  const st = must<{ shift_id: string; confirmed_count: number; pending_count: number; invited_count: number | null; open_slots: number }[]>(staffing, "staffing")
    .find((x) => x.shift_id === shiftId);
  return {
    shift: s.data as { id: string; event_id: string; starts_at: string; ends_at: string; required_count: number; status: string },
    event: ev.data as { id: string; title: string; venue_id: string; status: string; starts_at: string; ends_at: string },
    dutyName: (duty.data as { name: string } | null)?.name ?? "Duty",
    staffing: st ?? null,
  };
}

/** People on an event's duties plus who provides site-lead cover, read at one request time. */
export async function loadEventPeople(eventId: string) {
  const [rows, leads] = await Promise.all([loadRoster({ eventId }), loadCoverLeads(eventId)]);
  return { rows, leads, now: Date.now() };
}

/** Exact uncovered site-lead times for each event (only call for events flagged at risk / no cover). */
export async function loadCoverGaps(eventIds: string[]): Promise<Map<string, NonNullable<Coverage>>> {
  const sb = await createClient();
  const results = await Promise.all(eventIds.map((id) => sb.rpc("event_site_coverage", { p_event_id: id })));
  const out = new Map<string, NonNullable<Coverage>>();
  results.forEach((r, i) => {
    const row = must<NonNullable<Coverage>[]>(r, "venue cover")[0];
    if (row) out.set(eventIds[i], row);
  });
  return out;
}

/** Overview + roster for a window, read at one request time. */
export async function loadCoverageWindow(from: Date, to: Date, venueId: string | null) {
  const [overview, roster] = await Promise.all([loadOverview(from, to, venueId), loadRoster({ from, to, venueId })]);
  return { overview, roster, now: Date.now() };
}

export type AdminVolunteer = {
  id: string; email: string; display_name: string; phone: string | null; role: "admin" | "coordinator" | "volunteer";
  is_active: boolean; invited_at: string | null; linked_at: string | null;
  venues: string[]; authorisations: { duty_type_id: string; active: boolean; valid_until: string | null }[];
};

/** Volunteers visible to the caller (RLS: admins all; coordinators only people on their venues' duties). */
export async function loadVolunteers(): Promise<AdminVolunteer[]> {
  const sb = await createClient();
  const [v, cv, auth] = await Promise.all([
    sb.from("volunteers").select("id, email, display_name, phone, role, is_active, invited_at, linked_at").order("display_name"),
    sb.from("coordinator_venues").select("volunteer_id, venue_id"),
    sb.from("volunteer_duty_authorisations").select("volunteer_id, duty_type_id, active, valid_until"),
  ]);
  type V = Omit<AdminVolunteer, "venues" | "authorisations">;
  const venues = must<{ volunteer_id: string; venue_id: string }[]>(cv, "venue access");
  const auths = must<{ volunteer_id: string; duty_type_id: string; active: boolean; valid_until: string | null }[]>(auth, "authorisations");
  return must<V[]>(v, "volunteers").map((x) => ({
    ...x,
    venues: venues.filter((c) => c.volunteer_id === x.id).map((c) => c.venue_id),
    authorisations: auths.filter((a) => a.volunteer_id === x.id).map(({ duty_type_id, active, valid_until }) => ({ duty_type_id, active, valid_until })),
  }));
}

// ---------------------------------------------------------------------------
// Phase 6: email status for admins (counts only, never addresses or content)
// ---------------------------------------------------------------------------
export type OutboxSummaryRow = { status: "pending" | "sending" | "sent" | "failed" | "suppressed"; kind: string; message_count: number; last_error: string | null; oldest_due: string | null };

export async function loadOutboxSummary(): Promise<OutboxSummaryRow[]> {
  const sb = await createClient();
  const r = await sb.rpc("admin_outbox_summary");
  if (r.error) throw new Error("Could not load the email summary.");
  return (r.data ?? []) as OutboxSummaryRow[];
}
