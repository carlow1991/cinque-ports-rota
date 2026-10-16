-- Phase 3: the nine editable venue/event templates, transcribed from
-- docs/Duty_Catalogue_and_Venue_Templates_V1.md §4 (timings the catalogue leaves open use
-- the agreed defaults in docs/decisions.md Q2/Q3).
--
-- Idempotent and NON-destructive: keyed by template code and item sort_order. Re-running never
-- overwrites changes an administrator has since made to a template (ON CONFLICT DO NOTHING).
-- Offsets are minutes relative to the anchor (event_start = kick-off/start, event_end = planned end).

create or replace function pg_temp.tpl(p_code text, p_name text, p_type public.event_type, p_venue_code text, p_desc text)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.duty_templates (code, name, event_type, venue_id, description)
  values (p_code, p_name, p_type, (select id from public.venues where code = p_venue_code), p_desc)
  on conflict (code) do nothing;
  select id into v from public.duty_templates where code = p_code;
  return v;
end $$;

create or replace function pg_temp.item(
  p_tpl uuid, p_sort int, p_duty text, p_count int, p_enabled boolean,
  p_sa public.template_time_anchor, p_so int, p_ea public.template_time_anchor, p_eo int,
  p_suppressed boolean, p_when text, p_instructions text, p_resp text[] default '{}'
) returns void language plpgsql as $$
declare v uuid; r text;
begin
  insert into public.duty_template_items
    (template_id, sort_order, duty_type_id, required_count, enabled_by_default,
     start_anchor, start_offset_minutes, end_anchor, end_offset_minutes,
     suppressed_by_linked_cover, when_to_enable, instructions)
  values (p_tpl, p_sort, (select id from public.duty_types where code = p_duty), p_count, p_enabled,
          p_sa, p_so, p_ea, p_eo, p_suppressed, p_when, p_instructions)
  on conflict (template_id, sort_order) do nothing
  returning id into v;
  if v is not null then
    foreach r in array p_resp loop
      insert into public.template_item_responsibilities (template_item_id, duty_type_id)
      values (v, (select id from public.duty_types where code = r)) on conflict do nothing;
    end loop;
  end if;
end $$;

do $$
declare
  t uuid;
  s constant public.template_time_anchor := 'event_start';
  e constant public.template_time_anchor := 'event_end';
  lead_bundle constant text[] := array['open_unlock', 'facility_checks', 'lock_secure'];
  lead_note constant text := 'Includes opening, facility checks and locking up. If different people open or close, split this into separate non-overlapping shifts.';
begin
  -- T01 — Marke Wood: First Team home fixture. Core 5 slots; 8 with gate + tea bar.
  t := pg_temp.tpl('T01', 'Marke Wood: First Team home fixture', 'fixture', 'marke_wood',
    'Default core: 1 site lead + 2 setup + 2 cleaning = 5 slots. With gate and tea bar: 8 slots. Suggested defaults: adjust for demand and risk.');
  perform pg_temp.item(t, 10, 'site_lead',       1, true,  s, -75, e,  45, true,
    'Required unless fully covered by a linked venue-wide session.', lead_note, lead_bundle);
  perform pg_temp.item(t, 20, 'gate_admissions', 1, false, s, -45, s,  20, false,
    'Enable if admissions are being collected; adjust for arrivals.', null);
  perform pg_temp.item(t, 30, 'refreshments',    2, false, s, -45, e,  30, false,
    'Enable when the tea bar operates; reduce to 1 for quieter matches.', null);
  perform pg_temp.item(t, 40, 'pitch_setup',     2, true,  s, -75, s, -15, false,
    'Required by default; scale down if preparation is already arranged.', null);
  perform pg_temp.item(t, 50, 'cleaning',        2, true,  e,   0, e,  45, false,
    'Required by default; adjust for usage.', null);
  perform pg_temp.item(t, 60, 'general_support', 1, false, s, -30, e,  15, false,
    'Clearly describe the actual task.', 'Describe the actual task here.');

  -- T02 — Marke Wood: Other adult home fixture (Reserves, Ladies, Veterans, Sunday). Core 3.
  t := pg_temp.tpl('T02', 'Marke Wood: Other adult home fixture', 'fixture', 'marke_wood',
    'Reserves, Ladies, Veterans, Sunday. Default core: 3 slots. No assumption that gate or refreshments operate.');
  perform pg_temp.item(t, 10, 'site_lead',       1, true,  s, -60, e,  30, true,
    'Include open, facility checks and lock unless shared venue cover is linked.', lead_note, lead_bundle);
  perform pg_temp.item(t, 20, 'pitch_setup',     1, true,  s, -45, s, -10, false, null, null);
  perform pg_temp.item(t, 30, 'cleaning',        1, true,  e,   0, e,  30, false, null, null);
  perform pg_temp.item(t, 40, 'refreshments',    1, false, s, -30, e,  15, false, 'Enable only if the tea bar is operating.', null);
  perform pg_temp.item(t, 50, 'gate_admissions', 1, false, s, -30, s,  15, false, 'Enable only if collecting admission.', null);
  perform pg_temp.item(t, 60, 'general_support', 1, false, s,   0, e,   0, false, 'Task-based: enable only if a defined task exists.', 'Describe the actual task here.');

  -- T03 — Freemens Way: Youth fixture block. Core 2 setup + 1 cleaning + 1 shared lead if not covered.
  t := pg_temp.tpl('T03', 'Freemens Way: Youth fixture block', 'fixture', 'freemens_way',
    'e.g. U7/U9 morning. Link to a venue-coverage event for the site lead where one exists. Coaching and child safeguarding are NOT represented by these rota slots.');
  perform pg_temp.item(t, 10, 'site_lead',       1, true,  s, -60, e,  30, true,
    'Only if no adequate venue-wide cover exists: link a venue-coverage event instead where possible.', lead_note, lead_bundle);
  perform pg_temp.item(t, 20, 'pitch_setup',     2, true,  s, -45, s,   0, false, 'Multiple areas/equipment.', null);
  perform pg_temp.item(t, 30, 'cleaning',        1, true,  e,   0, e,  30, false, 'Raise to 2 if facilities are heavily used.', null);
  perform pg_temp.item(t, 40, 'refreshments',    1, false, s, -15, e,  15, false, 'Enable if the tea bar operates; raise to 2 if busy.', null);
  perform pg_temp.item(t, 50, 'general_support', 1, false, s,   0, e,   0, false, 'During the event; specify the help required.', 'Describe the actual task here.');
  perform pg_temp.item(t, 60, 'gate_admissions', 1, false, s, -30, s,  15, false, 'Not normally used; enable only if the club explicitly collects admissions.', null);

  -- T04 — Freemens Way: Adult home fixture. Core 2 event slots + 1 lead if not shared.
  t := pg_temp.tpl('T04', 'Freemens Way: Adult home fixture', 'fixture', 'freemens_way',
    'Default core: 2 event-specific slots and 1 site lead if not already shared.');
  perform pg_temp.item(t, 10, 'site_lead',       1, true,  s, -60, e,  30, true,
    'Only if not linked to adequate shared venue cover.', lead_note, lead_bundle);
  perform pg_temp.item(t, 20, 'pitch_setup',     1, true,  s, -45, s, -10, false, null, null);
  perform pg_temp.item(t, 30, 'cleaning',        1, true,  e,   0, e,  30, false, null, null);
  perform pg_temp.item(t, 40, 'refreshments',    1, false, s, -30, e,  15, false, 'Only if the tea bar is operating.', null);
  perform pg_temp.item(t, 50, 'gate_admissions', 1, false, s, -30, s,  15, false, 'Only if collecting admissions.', null);
  perform pg_temp.item(t, 60, 'general_support', 1, false, s,   0, e,   0, false, 'Only if a defined task exists.', 'Describe the actual task here.');

  -- T05 — Training session (either venue). No automatic requirement until venue arrangements are checked.
  t := pg_temp.tpl('T05', 'Training session', 'training', null,
    'Nothing is required automatically. The team coach is NOT automatically the site lead. If the club is responsible for the facility, enable the site lead, link venue cover, or have an admin record provider cover before publishing.');
  perform pg_temp.item(t, 10, 'site_lead',       1, false, s, -15, e,  15, true,
    'Only if the club is responsible for the facility and no adequate linked venue cover exists.', lead_note, lead_bundle);
  perform pg_temp.item(t, 20, 'pitch_setup',     1, false, s, -15, s,   0, false, 'Only if the venue requires club setup.', null);
  perform pg_temp.item(t, 30, 'cleaning',        1, false, e,   0, e,  15, false, 'If the venue requires a club clean-down.', null);

  -- T06 — Multi-fixture day / shared venue operations. Apply to ONE venue_coverage event, never per match.
  t := pg_temp.tpl('T06', 'Multi-fixture day / shared venue operations', 'venue_coverage', null,
    'Apply to one venue-coverage event for the full active window, never once per match. Fixture setup and cleaning stay on each fixture. For a mid-day handover, split the site lead into non-overlapping shifts.');
  perform pg_temp.item(t, 10, 'site_lead',       1, true,  s,   0, e,   0, false,
    'One per concurrent coverage window, for the full venue operational period.', lead_note, lead_bundle);
  perform pg_temp.item(t, 20, 'refreshments',    2, false, s,   0, e,   0, false, 'Activate if a shared refreshment service operates.', null);
  perform pg_temp.item(t, 30, 'gate_admissions', 1, false, s,   0, e,   0, false, 'Activate only if central entry/admission collection occurs.', null);
  perform pg_temp.item(t, 40, 'general_support', 1, false, s,   0, e,   0, false, 'Shared help across the venue, if meaningful.', 'Describe the actual task here.');

  -- T07 — Club event / community / fundraising. Core 7 slots over time.
  t := pg_temp.tpl('T07', 'Club event / community / fundraising', 'club_event', null,
    'Default core: 7 slots over time (not seven people at once). Also suitable for fundraising, meetings and other club events.');
  perform pg_temp.item(t, 10, 'site_lead',       1, true,  s, -60, e,  45, true, 'Include open/check/lock as appropriate.', lead_note, lead_bundle);
  perform pg_temp.item(t, 20, 'pitch_setup',     2, true,  s, -60, s, -10, false, null, 'Tables, signage and equipment as listed by the organiser.');
  perform pg_temp.item(t, 30, 'general_support', 2, true,  s,   0, e,   0, false, null, 'Describe the actual task here.');
  perform pg_temp.item(t, 40, 'cleaning',        2, true,  e,   0, e,  45, false, null, null);
  perform pg_temp.item(t, 50, 'refreshments',    2, false, s, -30, e,  15, false, 'Only if refreshments are operating.', null);
  perform pg_temp.item(t, 60, 'gate_admissions', 1, false, s, -30, s,  30, false, 'Only if ticketed or collecting admission.', null);

  -- T08 — Maintenance / working party. Core 5 slots. Specialist jobs need competent persons and risk assessment.
  t := pg_temp.tpl('T08', 'Maintenance / working party', 'maintenance', null,
    'Default core: 5 slots. Specialist jobs (electrical, machinery, heights, pitch treatment) need competent persons, a risk assessment and separate club safety procedures. The rota is not a qualification system.');
  perform pg_temp.item(t, 10, 'site_lead',       1, true,  s,   0, e,   0, true, 'Full session; include unlock/check/lock if relevant.', lead_note, lead_bundle);
  perform pg_temp.item(t, 20, 'general_support', 3, true,  s,   0, e,   0, false, 'Scale 2–4.', 'List the physical tasks and equipment.');
  perform pg_temp.item(t, 30, 'cleaning',        1, true,  e,   0, e,  30, false, null, null);
  perform pg_temp.item(t, 40, 'pitch_setup',     1, false, s, -30, s,   0, false, 'When preparatory equipment setup is actually needed.', null);

  -- T09 — Venue opening/closing coverage. ONE composite lead assignment from opening to closing.
  t := pg_temp.tpl('T09', 'Venue opening / closing coverage', 'venue_coverage', null,
    'One composite lead covering opening to closing. If nobody can stay responsible for the whole period, split the lead period between authorised people. Never assume full-day cover from someone who only unlocks.');
  perform pg_temp.item(t, 10, 'site_lead',       1, true,  s,   0, e,   0, false,
    'Entire operational period, if one person really is responsible for that window.', lead_note, lead_bundle);
end $$;
