-- Rollback for 20261019000300_hub_availability.sql (Volunteer Hub · Stage 3).
-- Drops availability requests, replies, Hub assignments and per-event expectation overrides.
-- These hold volunteer commitments: EXPORT them first (docs/hub runbook, "Export before rollback").
-- Restores the Stage 2 versions of the event hooks. Run in one transaction:  psql -1 -f this-file

drop function if exists public.hub_open_requests();
drop function if exists public.hub_my_home();
drop function if exists public.hub_people_picker();
drop function if exists public.hub_request_candidates(uuid);
drop function if exists public.hub_event_involvement(uuid);
drop function if exists public.hub_set_expected_override(uuid, uuid, text, text);
drop function if exists public.hub_cancel_assignment(uuid, text);
drop function if exists public.hub_record_assignment_response(uuid, boolean);
drop function if exists public._hub_can_manage_assignment(public.hub_assignments);
drop function if exists public.hub_withdraw_assignment(uuid, text);
drop function if exists public.hub_respond_assignment(uuid, boolean);
drop function if exists public.hub_invite_to_help(uuid, uuid, text, timestamptz, timestamptz, text);
drop function if exists public.hub_record_availability(uuid, uuid, text, boolean, timestamptz, timestamptz);
drop function if exists public.hub_respond_availability(uuid, text, boolean, timestamptz, timestamptz);
drop function if exists public._hub_save_availability(uuid, uuid, text, boolean, timestamptz, timestamptz, text, uuid);
drop function if exists public.hub_mark_request_contacted(uuid, uuid);
drop function if exists public.hub_request_availability(uuid, uuid[]);

create or replace function public._hub_after_event_change(p_event_id uuid, p_material boolean) returns void
language plpgsql security definer set search_path = '' as $$ begin return; end; $$;
create or replace function public._hub_after_event_cancel(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin return; end; $$;

drop table if exists public.event_participation_exceptions;
drop table if exists public.hub_assignments;
drop table if exists public.event_availability;
drop table if exists public.availability_requests;
drop function if exists public._hub_event_open(public.events);
drop function if exists public._hub_notify(text, uuid, text, uuid, jsonb, text);
-- Restore the Stage 2 hub_update_event (the Stage 3 version counts hub_assignments).
create or replace function public.hub_update_event(p_event_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_old public.events%rowtype;
  f jsonb;
  v_material boolean;
begin
  select * into v_old from public.events where id = p_event_id for update;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if v_old.status in ('cancelled', 'completed') then perform public._fail('invalid_transition', 'Cancelled or completed events can''t be edited. Copy it as a new event instead.'); end if;
  f := public._hub_event_fields(p, v_old.venue_id);
  if not (public.hub_is_admin() or public.hub_can_manage_venue((f ->> 'venue_id')::uuid) or public.hub_can_manage_team((f ->> 'team_id')::uuid)) then
    perform public._fail('not_authorised', 'You can only move events to your venues or teams.');
  end if;
  v_material := v_old.starts_at is distinct from (f ->> 'starts_at')::timestamptz
             or v_old.ends_at is distinct from (f ->> 'ends_at')::timestamptz
             or v_old.venue_id is distinct from (f ->> 'venue_id')::uuid
             or v_old.external_location_text is distinct from (f ->> 'external_location_text');
  update public.events set
    title = f ->> 'title', category = f ->> 'category', event_type = public._hub_event_type(f ->> 'category'),
    venue_id = (f ->> 'venue_id')::uuid, external_location_text = f ->> 'external_location_text',
    starts_at = (f ->> 'starts_at')::timestamptz, ends_at = (f ->> 'ends_at')::timestamptz, kickoff_at = (f ->> 'kickoff_at')::timestamptz,
    team_id = (f ->> 'team_id')::uuid, volunteers_enabled = (f ->> 'volunteers_enabled')::boolean, visibility = f ->> 'visibility',
    description = f ->> 'description', opponent = f ->> 'opponent', competition = f ->> 'competition',
    organiser_person_id = coalesce((f ->> 'organiser_person_id')::uuid, organiser_person_id),
    last_changed_by_person_id = v_me
  where id = p_event_id;
  perform public._hub_after_event_change(p_event_id, v_material);
  return jsonb_build_object('material', v_material);
end;
$$;

