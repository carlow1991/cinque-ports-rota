-- Volunteer Hub · Stage 5: club positions, postholders, recruitment and succession.
--  * Occupancy is DERIVED from current postholders (none = vacant, one = filled, several = shared).
--  * Recruiting flags (seeking a replacement / extra help / advertise a vacancy) are independent of it,
--    so a post held by someone can be "Filled — looking for a successor" without removing them.
--  * App records are internal: they are not a formal club/FA appointment or safeguarding clearance.
--  * The public sees ONLY a public-safe projection via a server-only function (anon still has nothing).
-- ADDITIVE ONLY. Rollback: docs/sql/rollback-20261019000500.sql

create table public.club_positions (
  id                                     uuid primary key default gen_random_uuid(),
  title                                  text not null check (char_length(btrim(title)) between 1 and 100),
  department                             text check (department is null or char_length(department) <= 60),
  public_summary                         text check (public_summary is null or char_length(public_summary) <= 1000),
  responsibilities                       text check (responsibilities is null or char_length(responsibilities) <= 3000),
  estimated_commitment                   text check (estimated_commitment is null or char_length(estimated_commitment) <= 200),
  work_location_preference               text check (work_location_preference in ('onsite', 'remote', 'either')),
  skills_required                        text[] not null default '{}' check (cardinality(skills_required) <= 20),
  skills_desirable                       text[] not null default '{}' check (cardinality(skills_desirable) <= 20),
  interest_tags                          text[] not null default '{}' check (cardinality(interest_tags) <= 20),
  training_available                     boolean not null default false,
  requires_external_safeguarding_review  boolean not null default false,
  public_visible                         boolean not null default false,
  recruiting_contact_person_id           uuid references public.people (id) on delete set null,
  active                                 boolean not null default true,
  seeking_replacement                    boolean not null default false,
  seeking_additional_help                boolean not null default false,
  publish_vacancy                        boolean not null default false,
  created_at                             timestamptz not null default now(),
  updated_at                             timestamptz not null default now()
);
create unique index club_positions_title_uq on public.club_positions (lower(title)) where active;

create table public.position_holders (
  id                uuid primary key default gen_random_uuid(),
  club_position_id  uuid not null references public.club_positions (id) on delete restrict,
  person_id         uuid not null references public.people (id) on delete restrict,
  start_date        date not null default ((now() at time zone 'Europe/London')::date),
  end_date          date,
  capacity_label    text not null default 'holder' check (capacity_label in ('holder', 'joint', 'acting', 'support')),
  note_private      text check (note_private is null or char_length(note_private) <= 500),
  created_at        timestamptz not null default now(),
  constraint position_holders_dates check (end_date is null or end_date >= start_date)
);
create index position_holders_position_idx on public.position_holders (club_position_id);
create index position_holders_person_idx on public.position_holders (person_id);

create table public.position_interests (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid references public.people (id) on delete cascade,
  application_id  uuid,  -- FK added with volunteer_applications (Stage 6)
  position_id     uuid not null references public.club_positions (id) on delete cascade,
  stage           text not null default 'interested'
                    check (stage in ('interested', 'contacted', 'discussion', 'shadowing', 'handover', 'appointed', 'withdrawn', 'closed')),
  note_private    text check (note_private is null or char_length(note_private) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint position_interests_who check (person_id is not null or application_id is not null)
);
create unique index position_interests_person_uq on public.position_interests (position_id, person_id) where person_id is not null;

do $$
declare t text;
begin
  foreach t in array array['club_positions', 'position_interests']
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
  foreach t in array array['club_positions', 'position_holders', 'position_interests']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- Members read positions (title, summary, flags) and current holders' names via the functions below.
create policy club_positions_read on public.club_positions for select to authenticated
  using ((select public.current_person_id()) is not null and (active or (select public.hub_is_admin())));
create policy position_holders_read on public.position_holders for select to authenticated
  using ((select public.hub_is_admin()) or person_id = (select public.current_person_id()));
create policy position_interests_read on public.position_interests for select to authenticated
  using ((select public.hub_is_admin()) or person_id = (select public.current_person_id()));

-- ---------------------------------------------------------------------------
-- Derived occupancy (as of a date)
-- ---------------------------------------------------------------------------
create function public._hub_holders_on(p_position_id uuid, p_on date default null) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.position_holders h
  where h.club_position_id = p_position_id
    and h.start_date <= coalesce(p_on, (now() at time zone 'Europe/London')::date)
    and (h.end_date is null or h.end_date >= coalesce(p_on, (now() at time zone 'Europe/London')::date))
$$;

create function public._hub_occupancy(p_position_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case public._hub_holders_on(p_position_id) when 0 then 'vacant' when 1 then 'filled' else 'shared' end
$$;

-- Is this position advertised publicly (and why)? Only when it's visible AND actually recruiting.
create function public._hub_public_reason(p public.club_positions) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not p.active or not p.public_visible then null
    when p.seeking_replacement then 'successor'
    when public._hub_occupancy(p.id) = 'vacant' and p.publish_vacancy then 'vacant'
    when p.seeking_additional_help then 'extra_help'
  end
$$;

-- ---------------------------------------------------------------------------
-- Admin management
-- ---------------------------------------------------------------------------
create function public.hub_save_position(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_title text := public._hub_clean(p ->> 'title', 120);
  arr text[];
begin
  perform public._hub_require('admin');
  if v_title is null or char_length(v_title) > 100 then perform public._fail('title_required', 'Give the role a title (up to 100 characters).'); end if;
  if p ? 'work_location_preference' and nullif(p ->> 'work_location_preference', '') is not null
     and p ->> 'work_location_preference' not in ('onsite', 'remote', 'either') then perform public._fail('invalid_location'); end if;
  if p_id is null then
    insert into public.club_positions (title) values (v_title) returning id into v_id;
  else
    v_id := p_id;
    if not exists (select 1 from public.club_positions where id = p_id) then perform public._fail('not_found'); end if;
  end if;
  update public.club_positions set
    title = v_title,
    department = public._hub_clean(p ->> 'department', 60),
    public_summary = public._hub_clean(p ->> 'public_summary', 1000),
    responsibilities = public._hub_clean(p ->> 'responsibilities', 3000),
    estimated_commitment = public._hub_clean(p ->> 'estimated_commitment', 200),
    work_location_preference = nullif(p ->> 'work_location_preference', ''),
    skills_required = coalesce((select array_agg(distinct left(btrim(x), 40)) from jsonb_array_elements_text(coalesce(p -> 'skills_required', '[]')) x where btrim(x) <> ''), '{}'),
    skills_desirable = coalesce((select array_agg(distinct left(btrim(x), 40)) from jsonb_array_elements_text(coalesce(p -> 'skills_desirable', '[]')) x where btrim(x) <> ''), '{}'),
    interest_tags = coalesce((select array_agg(distinct left(btrim(x), 40)) from jsonb_array_elements_text(coalesce(p -> 'interest_tags', '[]')) x where btrim(x) <> ''), '{}'),
    training_available = coalesce((p ->> 'training_available')::boolean, false),
    requires_external_safeguarding_review = coalesce((p ->> 'requires_external_safeguarding_review')::boolean, false),
    public_visible = coalesce((p ->> 'public_visible')::boolean, false),
    recruiting_contact_person_id = nullif(p ->> 'recruiting_contact_person_id', '')::uuid,
    active = coalesce((p ->> 'active')::boolean, true)
  where id = v_id;
  return v_id;
end;
$$;

-- Recruiting flags, independent of who holds the post.
create function public.hub_set_recruiting(p_position_id uuid, p_seeking_replacement boolean, p_seeking_additional_help boolean,
                                          p_publish_vacancy boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._hub_require('admin');
  update public.club_positions set seeking_replacement = coalesce(p_seeking_replacement, false),
    seeking_additional_help = coalesce(p_seeking_additional_help, false), publish_vacancy = coalesce(p_publish_vacancy, false)
  where id = p_position_id;
  if not found then perform public._fail('not_found'); end if;
end;
$$;

create function public.hub_add_holder(p_position_id uuid, p_person_id uuid, p_start date default null,
                                      p_capacity text default 'holder', p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public._hub_require('admin');
  if not exists (select 1 from public.club_positions where id = p_position_id) then perform public._fail('not_found'); end if;
  if not exists (select 1 from public.people where id = p_person_id and lifecycle_status = 'active') then perform public._fail('not_found'); end if;
  if p_capacity not in ('holder', 'joint', 'acting', 'support') then perform public._fail('invalid_capacity'); end if;
  if exists (select 1 from public.position_holders where club_position_id = p_position_id and person_id = p_person_id and end_date is null) then
    perform public._fail('already_holder', 'They already hold this role.');
  end if;
  insert into public.position_holders (club_position_id, person_id, start_date, capacity_label, note_private)
  values (p_position_id, p_person_id, coalesce(p_start, (now() at time zone 'Europe/London')::date), p_capacity, public._hub_clean(p_note, 500))
  returning id into v_id;
  return v_id;
end;
$$;

-- Ending a holding keeps it as history (never deleted).
create function public.hub_end_holder(p_holder_id uuid, p_end date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_h public.position_holders%rowtype;
begin
  perform public._hub_require('admin');
  select * into v_h from public.position_holders where id = p_holder_id for update;
  if not found then perform public._fail('not_found'); end if;
  if v_h.end_date is not null then perform public._fail('invalid_transition', 'That holding has already ended.'); end if;
  if coalesce(p_end, (now() at time zone 'Europe/London')::date) < v_h.start_date then
    perform public._fail('invalid_dates', 'The end date can''t be before they started.');
  end if;
  update public.position_holders set end_date = coalesce(p_end, (now() at time zone 'Europe/London')::date) where id = p_holder_id;
end;
$$;

-- Succession / interest pipeline (lightweight). 'appointed' is an internal note, not a formal appointment.
create function public.hub_set_interest(p_id uuid, p_position_id uuid, p_person_id uuid, p_stage text, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public._hub_require('admin');
  if p_stage not in ('interested', 'contacted', 'discussion', 'shadowing', 'handover', 'appointed', 'withdrawn', 'closed') then perform public._fail('invalid_stage'); end if;
  if p_id is null then
    if p_person_id is null then perform public._fail('person_required', 'Choose a person.'); end if;
    insert into public.position_interests (position_id, person_id, stage, note_private)
    values (p_position_id, p_person_id, p_stage, public._hub_clean(p_note, 1000))
    on conflict (position_id, person_id) where person_id is not null
      do update set stage = excluded.stage, note_private = coalesce(excluded.note_private, public.position_interests.note_private)
    returning id into v_id;
  else
    update public.position_interests set stage = p_stage, note_private = coalesce(public._hub_clean(p_note, 1000), note_private)
     where id = p_id returning id into v_id;
    if v_id is null then perform public._fail('not_found'); end if;
  end if;
  return v_id;
end;
$$;

-- A signed-in member says "I'm interested" in a role that's recruiting (idempotent).
create function public.hub_register_interest(p_position_id uuid, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('member');
  v_p public.club_positions%rowtype;
begin
  select * into v_p from public.club_positions where id = p_position_id and active;
  if not found then perform public._fail('not_found'); end if;
  if not (v_p.seeking_replacement or v_p.seeking_additional_help or (v_p.publish_vacancy and public._hub_occupancy(v_p.id) = 'vacant')) then
    perform public._fail('not_recruiting', 'This role isn''t looking for help at the moment.');
  end if;
  insert into public.position_interests (position_id, person_id, stage, note_private)
  values (p_position_id, v_me, 'interested', public._hub_clean(p_note, 1000))
  on conflict (position_id, person_id) where person_id is not null do nothing;
  return 'interested';
end;
$$;

-- Add the commonly used club roles as EMPTY drafts (no holders, nothing advertised). Explicit admin action.
create function public.hub_add_suggested_positions() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; r record;
begin
  perform public._hub_require('admin');
  for r in select * from (values
      ('Club Secretary', 'Administration', array['secretary', 'governance']),
      ('Senior Secretary', 'Administration', array['secretary']),
      ('Youth Secretary', 'Youth', array['secretary', 'youth_activities']),
      ('Groundsman', 'Grounds and facilities', array['pitch_marking', 'maintenance', 'open_close']),
      ('Social Media', 'Promotion and events', array['social_media', 'photography', 'website']),
      ('Finance', 'Administration', array['finance']),
      ('Vice-Chairman', 'Committee', array['governance']),
      ('Welfare Officer', 'Safeguarding', array['welfare'])) as t(title, dept, tags)
  loop
    if not exists (select 1 from public.club_positions where lower(title) = lower(r.title) and active) then
      insert into public.club_positions (title, department, interest_tags, requires_external_safeguarding_review)
      values (r.title, r.dept, r.tags, r.title in ('Welfare Officer', 'Youth Secretary'));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
-- Positions for signed-in members: titles, summaries, holder NAMES (no contact), derived occupancy and
-- recruiting flags. Admins additionally get inactive roles, interest counts and the holders' history.
create function public.hub_positions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin boolean := public.hub_is_admin();
  v_me uuid := public._hub_require('member');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'department', p.department, 'public_summary', p.public_summary, 'responsibilities', p.responsibilities,
      'estimated_commitment', p.estimated_commitment, 'work_location_preference', p.work_location_preference,
      'skills_required', p.skills_required, 'skills_desirable', p.skills_desirable, 'interest_tags', p.interest_tags,
      'training_available', p.training_available, 'requires_external_safeguarding_review', p.requires_external_safeguarding_review,
      'public_visible', p.public_visible, 'active', p.active,
      'seeking_replacement', p.seeking_replacement, 'seeking_additional_help', p.seeking_additional_help, 'publish_vacancy', p.publish_vacancy,
      'occupancy', public._hub_occupancy(p.id), 'public_reason', public._hub_public_reason(p),
      'recruiting_contact', (select coalesce(c.display_name, c.full_name) from public.people c where c.id = p.recruiting_contact_person_id),
      'recruiting_contact_person_id', case when v_admin then p.recruiting_contact_person_id end,
      'holders', coalesce((select jsonb_agg(jsonb_build_object('id', case when v_admin then h.id end, 'person_id', h.person_id,
                                    'name', coalesce(pp.display_name, pp.full_name), 'capacity', h.capacity_label,
                                    'start_date', case when v_admin then h.start_date end) order by h.start_date)
                           from public.position_holders h join public.people pp on pp.id = h.person_id
                           where h.club_position_id = p.id and h.start_date <= (now() at time zone 'Europe/London')::date
                             and (h.end_date is null or h.end_date >= (now() at time zone 'Europe/London')::date)), '[]'::jsonb),
      'history', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'name', coalesce(pp.display_name, pp.full_name),
                                    'capacity', h.capacity_label, 'start_date', h.start_date, 'end_date', h.end_date) order by h.end_date desc)
                           from public.position_holders h join public.people pp on pp.id = h.person_id
                           where h.club_position_id = p.id and h.end_date is not null and h.end_date < (now() at time zone 'Europe/London')::date), '[]'::jsonb) end,
      'interests', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'person_id', i.person_id, 'application_id', i.application_id,
                                    'name', (select coalesce(x.display_name, x.full_name) from public.people x where x.id = i.person_id),
                                    'stage', i.stage, 'note', i.note_private, 'updated_at', i.updated_at) order by i.updated_at desc)
                           from public.position_interests i where i.position_id = p.id), '[]'::jsonb) end,
      'my_interest', (select i.stage from public.position_interests i where i.position_id = p.id and i.person_id = v_me))
      order by p.department nulls last, p.title)
    from public.club_positions p where p.active or v_admin), '[]'::jsonb);
end;
$$;

-- PUBLIC, via the server only (secret key): advertised roles, public-safe copy only.
-- Never holder names, contact details, notes or interest data.
create function public.public_opportunities() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'department', p.department, 'summary', p.public_summary, 'responsibilities', p.responsibilities,
    'commitment', p.estimated_commitment, 'location', p.work_location_preference, 'skills', p.skills_desirable || p.skills_required,
    'training_available', p.training_available, 'checks_needed', p.requires_external_safeguarding_review,
    'reason', public._hub_public_reason(p)) order by p.title), '[]'::jsonb)
  from public.club_positions p
  where public._hub_public_reason(p) is not null
$$;

-- The directory now also lists current club roles (Stage 1 function, extended).
drop function public.hub_directory();
create function public.hub_directory() returns table (
  person_id uuid, name text, involvement text[], teams jsonb, positions jsonb, email text, phone text,
  portal_status text, routine_requests_enabled boolean, lifecycle_status text, is_under_18 boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_level text := public.current_access_level();
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  if public.current_person_id() is null then perform public._fail('not_authorised'); end if;
  return query
  select p.id, coalesce(p.display_name, p.full_name), p.involvement,
    coalesce((select jsonb_agg(jsonb_build_object('team', t.name, 'role', tp.role_label) order by t.name)
              from public.team_people tp join public.teams t on t.id = tp.team_id
              where tp.person_id = p.id and tp.active_from <= v_today and (tp.active_to is null or tp.active_to >= v_today)), '[]'::jsonb),
    coalesce((select jsonb_agg(cp.title order by cp.title)
              from public.position_holders h join public.club_positions cp on cp.id = h.club_position_id and cp.active
              where h.person_id = p.id and h.start_date <= v_today and (h.end_date is null or h.end_date >= v_today)), '[]'::jsonb),
    case when v_level in ('admin', 'coordinator') or p.share_email_with_members then p.email_normalized::text end,
    case when v_level in ('admin', 'coordinator') or p.share_phone_with_members then p.phone_normalized end,
    case when v_level = 'admin' then
      case when ua.person_id is null then 'not_invited'
           when not ua.enabled then 'disabled'
           when ua.auth_user_id is not null then 'active'
           when ua.invite_state = 'failed' then 'invite_failed'
           when ua.invite_state = 'sent' then 'invited'
           else 'invite_not_sent' end end,
    case when v_level = 'admin' then p.routine_requests_enabled end,
    case when v_level in ('admin', 'coordinator') then p.lifecycle_status end,
    case when v_level in ('admin', 'coordinator') then p.is_under_18 end
  from public.people p
  left join public.user_accounts ua on ua.person_id = p.id
  where case
    when v_level = 'admin' then p.lifecycle_status <> 'applicant'
    when v_level = 'coordinator' then p.lifecycle_status = 'active'
    else p.lifecycle_status = 'active' and p.directory_visibility = 'members' and not p.is_under_18 end
  order by lower(coalesce(p.display_name, p.full_name));
end;
$$;

grant execute on function public.hub_directory(), public.hub_save_position(uuid, jsonb), public.hub_set_recruiting(uuid, boolean, boolean, boolean),
  public.hub_add_holder(uuid, uuid, date, text, text), public.hub_end_holder(uuid, date), public.hub_set_interest(uuid, uuid, uuid, text, text),
  public.hub_register_interest(uuid, text), public.hub_add_suggested_positions(), public.hub_positions()
to authenticated;
revoke execute on function public.public_opportunities() from public, anon, authenticated;
grant execute on function public.public_opportunities() to service_role;
