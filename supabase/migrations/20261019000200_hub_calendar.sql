-- Volunteer Hub · Stage 2: one club calendar for every event, minimal event entry.
-- Extends the EXISTING events table so every existing event keeps its id, history and links.
--  * venue OR free-text outside/away location; finish time may be unknown (kick-off only)
--  * category (checked text, so no enum change is needed), volunteers toggle, visibility, organiser
--  * Freemens Way is kept but made INACTIVE (spec 06 §1): excluded from new events, history intact.
-- Legacy template/shift tables are untouched. Rollback: docs/sql/rollback-20261019000200.sql

alter table public.events
  alter column venue_id drop not null,
  alter column ends_at drop not null,
  alter column event_type set default 'other',
  add column external_location_text text check (external_location_text is null or char_length(btrim(external_location_text)) between 1 and 200),
  add column category text not null default 'other'
    check (category in ('match', 'training', 'mini_kickers', 'youth', 'meeting', 'social', 'maintenance', 'other')),
  add column volunteers_enabled boolean not null default false,
  add column visibility text not null default 'members' check (visibility in ('members', 'public_if_explicit')),
  add column organiser_person_id uuid references public.people (id) on delete set null,
  add column created_by_person_id uuid references public.people (id) on delete set null,
  add column last_changed_by_person_id uuid references public.people (id) on delete set null,
  add column cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500);

alter table public.events drop constraint events_valid_interval;
alter table public.events drop constraint events_max_length;
alter table public.events
  add constraint events_valid_interval check (ends_at is null or starts_at < ends_at),
  add constraint events_max_length check (ends_at is null or ends_at - starts_at <= interval '24 hours'),
  add constraint events_kickoff_within check (kickoff_at is null or ends_at is null or kickoff_at <= ends_at),
  add constraint events_has_location check (venue_id is not null or external_location_text is not null);

create index events_category_starts_idx on public.events (category, starts_at);
create index events_team_starts_idx on public.events (team_id, starts_at) where team_id is not null;

-- Existing events become calendar entries with a sensible category.
update public.events set category = case event_type
    when 'fixture' then 'match' when 'training' then 'training' when 'meeting' then 'meeting'
    when 'maintenance' then 'maintenance' when 'fundraising' then 'social' when 'club_event' then 'social'
    else 'other' end;

-- Freemens Way: retained, inactive. Nothing referencing it is changed.
update public.venues set active = false where code = 'freemens_way';

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
create function public.hub_can_manage_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.hub_is_admin() or public.hub_can_manage_venue(e.venue_id) or public.hub_can_manage_team(e.team_id)
                   from public.events e where e.id = p_event_id), false)
$$;

-- Members see every non-draft club event (including away and information-only); drafts only
-- by the organisers who can manage them.
create policy events_read_hub on public.events for select to authenticated
  using ((select public.current_person_id()) is not null
         and (status <> 'draft' or public.hub_can_manage_event(id)));

-- Category → legacy event_type (kept meaningful for the retired screens).
create function public._hub_event_type(p_category text) returns public.event_type
language sql immutable set search_path = '' as $$
  select (case p_category when 'match' then 'fixture' when 'training' then 'training' when 'meeting' then 'meeting'
          when 'maintenance' then 'maintenance' when 'social' then 'club_event' else 'other' end)::public.event_type
$$;

-- Validate an event payload. Times arrive as absolute instants (the app converts UK wall-clock
-- times, refusing non-existent DST times). Returns the cleaned values.
create function public._hub_event_fields(p jsonb, p_existing_venue uuid default null) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_title text := public._hub_clean(p ->> 'title', 200);
  v_cat text := coalesce(nullif(p ->> 'category', ''), 'other');
  v_venue uuid := nullif(p ->> 'venue_id', '')::uuid;
  v_ext text := public._hub_clean(p ->> 'external_location_text', 300);
  v_starts timestamptz := nullif(p ->> 'starts_at', '')::timestamptz;
  v_ends timestamptz := nullif(p ->> 'ends_at', '')::timestamptz;
  v_kick timestamptz := nullif(p ->> 'kickoff_at', '')::timestamptz;
  v_team uuid := nullif(p ->> 'team_id', '')::uuid;
  v_active boolean;
begin
  if v_title is null or char_length(v_title) > 120 then perform public._fail('title_required', 'Give the event a name (up to 120 characters).'); end if;
  if v_cat not in ('match', 'training', 'mini_kickers', 'youth', 'meeting', 'social', 'maintenance', 'other') then perform public._fail('invalid_category'); end if;
  if v_starts is null then perform public._fail('start_required', 'Enter a date and start time.'); end if;
  if v_ends is not null and v_ends <= v_starts then perform public._fail('invalid_times', 'The finish must be after the start.'); end if;
  if v_ends is not null and v_ends - v_starts > interval '24 hours' then perform public._fail('invalid_times', 'An event can last at most 24 hours.'); end if;
  if v_kick is not null and (v_kick < v_starts - interval '12 hours' or (v_ends is not null and v_kick > v_ends)) then
    perform public._fail('invalid_kickoff', 'Kick-off must fall within the event.');
  end if;
  if v_venue is null and v_ext is null then perform public._fail('location_required', 'Choose a venue or type where it is.'); end if;
  if v_venue is not null then
    v_ext := null;
    select active into v_active from public.venues where id = v_venue;
    if not found then perform public._fail('not_found', 'That venue no longer exists.'); end if;
    -- Inactive venues can't be chosen for new events; an existing event may keep its venue.
    if not v_active and v_venue is distinct from p_existing_venue then
      perform public._fail('venue_inactive', 'That venue is inactive. Choose another or type an outside location.');
    end if;
  elsif char_length(v_ext) > 200 then
    perform public._fail('location_too_long', 'Keep the location under 200 characters.');
  end if;
  if v_team is not null and not exists (select 1 from public.teams where id = v_team) then perform public._fail('not_found', 'That team no longer exists.'); end if;
  return jsonb_build_object('title', v_title, 'category', v_cat, 'venue_id', v_venue, 'external_location_text', v_ext,
    'starts_at', v_starts, 'ends_at', v_ends, 'kickoff_at', v_kick, 'team_id', v_team,
    'volunteers_enabled', coalesce((p ->> 'volunteers_enabled')::boolean, false),
    'visibility', case when p ->> 'visibility' = 'public_if_explicit' then 'public_if_explicit' else 'members' end,
    'description', public._hub_clean(p ->> 'description', 4000),
    'opponent', public._hub_clean(p ->> 'opponent', 120),
    'competition', public._hub_clean(p ->> 'competition', 120),
    'organiser_person_id', nullif(p ->> 'organiser_person_id', '')::uuid);
end;
$$;

-- Create: event only. Never sends anything; publishing only controls who can see it.
create function public.hub_create_event(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  f jsonb := public._hub_event_fields(p);
  v_status text := case when p ->> 'status' = 'published' then 'published' else 'draft' end;
  v_id uuid;
begin
  if not (public.hub_is_admin() or public.hub_can_manage_venue((f ->> 'venue_id')::uuid) or public.hub_can_manage_team((f ->> 'team_id')::uuid)) then
    perform public._fail('not_authorised', 'You can only add events at your venues or for your teams.');
  end if;
  insert into public.events (title, category, event_type, venue_id, external_location_text, starts_at, ends_at, kickoff_at, team_id,
                             volunteers_enabled, visibility, description, opponent, competition, organiser_person_id, status,
                             site_responsibility, created_by_person_id, last_changed_by_person_id)
  values (f ->> 'title', f ->> 'category', public._hub_event_type(f ->> 'category'), (f ->> 'venue_id')::uuid, f ->> 'external_location_text',
          (f ->> 'starts_at')::timestamptz, (f ->> 'ends_at')::timestamptz, (f ->> 'kickoff_at')::timestamptz, (f ->> 'team_id')::uuid,
          (f ->> 'volunteers_enabled')::boolean, f ->> 'visibility', f ->> 'description', f ->> 'opponent', f ->> 'competition',
          coalesce((f ->> 'organiser_person_id')::uuid, v_me), v_status::public.event_status,
          false, v_me, v_me)
  returning id into v_id;
  return v_id;
end;
$$;

-- Update. Returns {material: bool} — a date/time/venue change (Stage 3 uses it to ask people to reconfirm).
create function public.hub_update_event(p_event_id uuid, p jsonb) returns jsonb
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

-- Hook for Stage 3 (reconfirmation of commitments after a material change). No-op until then.
create function public._hub_after_event_change(p_event_id uuid, p_material boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  return;
end;
$$;

-- publish | cancel | complete | draft (unpublish). Publishing sends nothing.
create function public.hub_set_event_status(p_event_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_old public.events%rowtype;
begin
  select * into v_old from public.events where id = p_event_id for update;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if p_status not in ('published', 'cancelled', 'completed', 'draft') then perform public._fail('invalid_transition'); end if;
  if v_old.status = 'cancelled' or (v_old.status = 'completed' and p_status <> 'completed') then
    perform public._fail('invalid_transition', 'This event is already ' || v_old.status || '.');
  end if;
  if p_status = 'cancelled' and public._hub_clean(p_reason, 500) is null then
    perform public._fail('reason_required', 'Say briefly why it''s cancelled. People who look at the event will see it.');
  end if;
  update public.events set status = p_status::public.event_status,
    cancel_reason = case when p_status = 'cancelled' then public._hub_clean(p_reason, 500) else cancel_reason end,
    last_changed_by_person_id = v_me
  where id = p_event_id;
  if p_status = 'cancelled' then perform public._hub_after_event_cancel(p_event_id); end if;
end;
$$;

-- Hook for Stage 3/7 (suppress reminders, cancel commitments). No-op until then.
create function public._hub_after_event_cancel(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  return;
end;
$$;

grant execute on function public.hub_can_manage_event(uuid), public.hub_create_event(jsonb),
  public.hub_update_event(uuid, jsonb), public.hub_set_event_status(uuid, text, text) to authenticated;
