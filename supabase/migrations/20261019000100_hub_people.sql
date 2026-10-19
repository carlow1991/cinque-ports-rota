-- Volunteer Hub · Stage 1: people directory, portal accounts, teams and expected officials.
-- ADDITIVE ONLY. Legacy tables (volunteers, coordinator_venues, …) are untouched and stay readable.
-- Every existing volunteer is copied into people with the SAME id, and (if invited/linked) into
-- user_accounts with the SAME auth_user_id, so existing sign-ins and foreign keys keep working.
-- Rollback: docs/sql/rollback-20261019000100.sql

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.people (
  id                        uuid primary key default gen_random_uuid(),
  full_name                 text not null check (char_length(btrim(full_name)) between 1 and 120),
  display_name              text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  email_normalized          extensions.citext unique
                              check (email_normalized is null or (email_normalized ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email_normalized) <= 254)),
  phone_normalized          text check (phone_normalized is null or phone_normalized ~ '^\+?[0-9]{6,15}$'),
  preferred_contact_channel text check (preferred_contact_channel in ('email', 'phone', 'whatsapp')),
  lifecycle_status          text not null default 'active' check (lifecycle_status in ('active', 'applicant', 'inactive')),
  -- Preference only: suggests this person when an organiser builds an availability request.
  -- Never sends anything by itself.
  routine_requests_enabled  boolean not null default false,
  involvement               text[] not null default '{}'
                              check (involvement <@ array['volunteer', 'manager', 'official', 'other']::text[]),
  -- 'members' = name, teams and club roles listed to signed-in members. Contact details are
  -- shown to members ONLY if the matching share flag is on (default off).
  directory_visibility      text not null default 'members' check (directory_visibility in ('private', 'members')),
  share_email_with_members  boolean not null default false,
  share_phone_with_members  boolean not null default false,
  is_under_18               boolean not null default false,
  notes_private             text check (notes_private is null or char_length(notes_private) <= 2000),
  created_by_person_id      uuid references public.people (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- Under-18s are never listed to members and never have contact details shared.
  constraint people_minor_private check (
    not is_under_18 or (directory_visibility = 'private' and not share_email_with_members and not share_phone_with_members))
);
create index people_phone_idx on public.people (phone_normalized) where phone_normalized is not null;
create index people_name_idx on public.people (lower(full_name));
comment on table public.people is
  'Anyone connected with the club. A row never implies a login: portal access lives in user_accounts.';

create table public.user_accounts (
  person_id          uuid primary key references public.people (id) on delete cascade,
  auth_user_id       uuid unique references auth.users (id) on delete set null,
  access_level       text not null default 'member' check (access_level in ('admin', 'coordinator', 'member')),
  enabled            boolean not null default true,
  -- Invitation is an explicit admin ACTION. invited_at is set only by hub_prepare_portal_invite().
  invited_at         timestamptz,
  invite_state       text not null default 'not_sent' check (invite_state in ('not_sent', 'sent', 'failed', 'manual')),
  invite_attempts    integer not null default 0,
  last_invite_at     timestamptz,
  last_invite_error  text check (last_invite_error is null or char_length(last_invite_error) <= 200),
  linked_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.user_accounts is
  'Portal access for a person. A person can sign in only once an admin has invited them AND Auth has verified the email.';

create table public.coordinator_scopes (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.people (id) on delete cascade,
  venue_id   uuid references public.venues (id) on delete cascade,
  team_id    uuid references public.teams (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint coordinator_scopes_one_target check ((venue_id is null) <> (team_id is null))
);
create unique index coordinator_scopes_venue_uq on public.coordinator_scopes (person_id, venue_id) where venue_id is not null;
create unique index coordinator_scopes_team_uq on public.coordinator_scopes (person_id, team_id) where team_id is not null;

create table public.team_people (
  id                      uuid primary key default gen_random_uuid(),
  team_id                 uuid not null references public.teams (id) on delete restrict,
  person_id               uuid not null references public.people (id) on delete cascade,
  role_label              text not null check (char_length(btrim(role_label)) between 1 and 60),
  is_expected_by_default  boolean not null default false,
  active_from             date not null default ((now() at time zone 'Europe/London')::date),
  active_to               date,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint team_people_dates check (active_to is null or active_to >= active_from)
);
create index team_people_team_idx on public.team_people (team_id, active_from);
create index team_people_person_idx on public.team_people (person_id);

create table public.volunteer_preferences (
  person_id            uuid primary key references public.people (id) on delete cascade,
  commitment_bucket    text check (commitment_bucket in ('lt2', '2to4', '5to10', '10plus', 'varies')),
  commitment_pattern   text check (commitment_pattern in ('regular', 'occasional', 'one_off', 'unsure')),
  location_preference  text check (location_preference in ('onsite', 'remote', 'either')),
  willing_to_learn     text check (willing_to_learn in ('yes', 'maybe', 'no')),
  strengths            text[] not null default '{}' check (cardinality(strengths) <= 20),
  interests            text[] not null default '{}' check (cardinality(interests) <= 40),
  free_text            text check (free_text is null or char_length(free_text) <= 1000),
  updated_at           timestamptz not null default now()
);

-- day_of_week: 0 = Monday … 6 = Sunday (ISO order, documented here and in lib/domain/hub-tags.ts)
create table public.usual_availability (
  person_id    uuid not null references public.people (id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  daypart      text not null check (daypart in ('morning', 'afternoon', 'evening')),
  primary key (person_id, day_of_week, daypart)
);

-- Audit: who (as a person) and from where.
alter table public.audit_log
  add column actor_person_id uuid references public.people (id) on delete set null,
  add column source text check (source is null or char_length(source) <= 40);

do $$
declare t text;
begin
  foreach t in array array['people', 'user_accounts', 'team_people']
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- Normalisation shared by the app, the public form and duplicate checks.
create function public._hub_normalize_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when v is null or v = '' then null
    when v ~ '^0[0-9]{9,10}$' then '+44' || substr(v, 2)
    when v ~ '^44[0-9]{9,10}$' then '+' || v
    else v end
  from (select regexp_replace(btrim(coalesce(p, '')), '[^0-9+]', '', 'g') as v) s
$$;

create function public._hub_clean(p text, p_max int) returns text
language sql immutable set search_path = '' as $$
  select case when p is null or btrim(p) = '' then null else left(btrim(p), p_max) end
$$;

-- ---------------------------------------------------------------------------
-- Copy legacy volunteers (same ids, same auth links). Idempotent.
-- ---------------------------------------------------------------------------
insert into public.people (id, full_name, display_name, email_normalized, phone_normalized, lifecycle_status,
                           involvement, created_at, updated_at)
select v.id, v.display_name, v.display_name, lower(v.email::text),
       public._hub_normalize_phone(v.phone),
       case when v.is_active then 'active' else 'inactive' end,
       case when v.role in ('admin', 'coordinator') then array['volunteer', 'official'] else array['volunteer'] end,
       v.created_at, v.updated_at
from public.volunteers v
on conflict (id) do nothing;

-- Legacy phone values that don't fit the normalised pattern are dropped from people.phone_normalized
-- (they remain intact in volunteers.phone) rather than failing the migration.
update public.people p set phone_normalized = null
where p.phone_normalized is not null and p.phone_normalized !~ '^\+?[0-9]{6,15}$';

insert into public.user_accounts (person_id, auth_user_id, access_level, enabled, invited_at, invite_state, linked_at,
                                  last_invite_at, created_at)
select v.id, v.auth_user_id,
       case v.role when 'admin' then 'admin' when 'coordinator' then 'coordinator' else 'member' end,
       v.is_active, v.invited_at,
       case when v.invited_at is not null or v.auth_user_id is not null then 'sent' else 'not_sent' end,
       v.linked_at, v.invited_at, v.created_at
from public.volunteers v
where v.invited_at is not null or v.auth_user_id is not null
on conflict (person_id) do nothing;

insert into public.coordinator_scopes (person_id, venue_id)
select cv.volunteer_id, cv.venue_id from public.coordinator_venues cv
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Identity helpers (NULL/false for anyone without an enabled account on an active person)
-- ---------------------------------------------------------------------------
create function public.current_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select ua.person_id from public.user_accounts ua
  join public.people p on p.id = ua.person_id
  where ua.auth_user_id = auth.uid() and ua.enabled and p.lifecycle_status = 'active'
$$;

create function public.current_access_level() returns text
language sql stable security definer set search_path = '' as $$
  select ua.access_level from public.user_accounts ua
  join public.people p on p.id = ua.person_id
  where ua.auth_user_id = auth.uid() and ua.enabled and p.lifecycle_status = 'active'
$$;

create function public.hub_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_access_level() = 'admin', false)
$$;

create function public.hub_is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_access_level() in ('admin', 'coordinator'), false)
$$;

create function public.hub_can_manage_venue(p_venue_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.current_access_level()
    when 'admin' then true
    when 'coordinator' then p_venue_id is not null and exists (
      select 1 from public.coordinator_scopes s where s.person_id = public.current_person_id() and s.venue_id = p_venue_id)
    else false end
$$;

create function public.hub_can_manage_team(p_team_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.current_access_level()
    when 'admin' then true
    when 'coordinator' then p_team_id is not null and exists (
      select 1 from public.coordinator_scopes s where s.person_id = public.current_person_id() and s.team_id = p_team_id)
    else false end
$$;

create function public._hub_require(p_level text default 'member') returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid := public.current_person_id();
  v_level text := public.current_access_level();
begin
  if v_id is null then perform public._fail('not_authorised', 'Sign in with an active account.'); end if;
  if p_level = 'admin' and v_level <> 'admin' then
    perform public._fail('not_authorised', 'Only club administrators can do that.');
  end if;
  if p_level = 'manager' and v_level not in ('admin', 'coordinator') then
    perform public._fail('not_authorised', 'Only organisers can do that.');
  end if;
  return v_id;
end;
$$;

-- Audit helper for Hub functions (explicit, so the source of a change is recorded).
create function public._hub_audit(p_action text, p_entity_type text, p_entity_id uuid,
                                  p_old jsonb default null, p_new jsonb default null, p_source text default 'portal')
returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_volunteer_id, actor_person_id, action, entity_type, entity_id, old_data, new_data, source)
  values (
    (select v.id from public.volunteers v where v.id = public.current_person_id()),
    public.current_person_id(), p_action, p_entity_type, p_entity_id,
    p_old - array['email', 'phone', 'email_normalized', 'phone_normalized', 'auth_user_id'],
    p_new - array['email', 'phone', 'email_normalized', 'phone_normalized', 'auth_user_id'],
    p_source)
$$;

-- Generic row audit now also records the acting person and redacts Hub contact columns.
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_id  uuid;
  v_redact text[] := array['email', 'phone', 'auth_user_id', 'email_normalized', 'phone_normalized', 'notes_private', 'last_invite_error'];
begin
  if v_old is not null then v_old := v_old - v_redact; end if;
  if v_new is not null then v_new := v_new - v_redact; end if;
  if tg_op = 'UPDATE' and v_old - 'updated_at' = v_new - 'updated_at' then
    return null;
  end if;
  v_id := (select x::uuid from unnest(array[v_new ->> 'id', v_old ->> 'id', v_new ->> 'person_id', v_old ->> 'person_id',
                                            v_new ->> 'volunteer_id', v_old ->> 'volunteer_id']) x
           where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 1);
  insert into public.audit_log (actor_volunteer_id, actor_person_id, action, entity_type, entity_id, old_data, new_data, source)
  values (public.current_volunteer_id(), public.current_person_id(), lower(tg_op), tg_table_name, v_id, v_old, v_new,
          coalesce(nullif(current_setting('hub.audit_source', true), ''), 'portal'));
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['people', 'user_accounts', 'coordinator_scopes', 'team_people']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function public.audit_row_change()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Account linking (replaces link_volunteer_account for sign-in). Identity only from auth.uid()
-- and Auth's VERIFIED email. Returns linked | already_linked | not_invited | inactive | unverified | conflict
-- ---------------------------------------------------------------------------
create function public.link_person_account() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_acc public.user_accounts%rowtype;
  v_person public.people%rowtype;
begin
  if v_uid is null then return 'unverified'; end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
  if v_email is null or v_confirmed is null then return 'unverified'; end if;

  select * into v_acc from public.user_accounts where auth_user_id = v_uid for update;
  if found then
    select * into v_person from public.people where id = v_acc.person_id;
    return case when v_acc.enabled and v_person.lifecycle_status = 'active' then 'already_linked' else 'inactive' end;
  end if;

  select * into v_person from public.people
  where email_normalized operator(extensions.=) v_email::extensions.citext for update;
  if not found then return 'not_invited'; end if;
  select * into v_acc from public.user_accounts where person_id = v_person.id for update;
  if not found or v_acc.invited_at is null then return 'not_invited'; end if;
  if not v_acc.enabled or v_person.lifecycle_status <> 'active' then return 'inactive'; end if;
  if v_acc.auth_user_id is not null then return 'conflict'; end if;

  update public.user_accounts set auth_user_id = v_uid, linked_at = now() where person_id = v_person.id;
  -- Keep the legacy volunteers row (same id) pointing at the same Auth user, if one exists.
  update public.volunteers set auth_user_id = v_uid, linked_at = now()
   where id = v_person.id and auth_user_id is null;
  return 'linked';
end;
$$;

-- Who am I? (for the app's access checks)
create function public.hub_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('person_id', p.id, 'name', coalesce(p.display_name, p.full_name),
                            'access_level', ua.access_level, 'enabled', ua.enabled and p.lifecycle_status = 'active')
  from public.user_accounts ua join public.people p on p.id = ua.person_id
  where ua.auth_user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- People: create / update (admins). Saving NEVER sends anything.
-- p: {full_name, display_name, email, phone, preferred_contact_channel, involvement[], routine_requests_enabled,
--     directory_visibility, share_email_with_members, share_phone_with_members, is_under_18, notes_private,
--     lifecycle_status}
-- ---------------------------------------------------------------------------
create function public._hub_person_fields(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_email text := lower(public._hub_clean(p ->> 'email', 254));
  v_phone text := public._hub_normalize_phone(p ->> 'phone');
  v_name text := public._hub_clean(p ->> 'full_name', 200);
begin
  if v_name is null or char_length(v_name) > 120 then perform public._fail('invalid_name', 'Enter a name (up to 120 characters).'); end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public._fail('invalid_email', 'Enter a valid email address, or leave it blank.'); end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{6,15}$' then perform public._fail('invalid_phone', 'Enter a valid phone number, or leave it blank.'); end if;
  return jsonb_build_object('full_name', v_name, 'email', v_email, 'phone', v_phone);
end;
$$;

create function public.hub_create_person(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('admin');
  f jsonb := public._hub_person_fields(p);
  v_id uuid;
  v_minor boolean := coalesce((p ->> 'is_under_18')::boolean, false);
begin
  if f ->> 'email' is not null and exists (select 1 from public.people where email_normalized operator(extensions.=) (f ->> 'email')::extensions.citext) then
    perform public._fail('duplicate_email', 'Someone in the directory already has that email address. Open their record instead.');
  end if;
  insert into public.people (full_name, display_name, email_normalized, phone_normalized, preferred_contact_channel,
                             involvement, routine_requests_enabled, directory_visibility, share_email_with_members,
                             share_phone_with_members, is_under_18, notes_private, created_by_person_id)
  values (f ->> 'full_name', public._hub_clean(p ->> 'display_name', 80), f ->> 'email', f ->> 'phone',
          nullif(p ->> 'preferred_contact_channel', ''),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'involvement', '[]')) x), '{}'),
          coalesce((p ->> 'routine_requests_enabled')::boolean, false),
          case when v_minor then 'private' else coalesce(nullif(p ->> 'directory_visibility', ''), 'members') end,
          not v_minor and coalesce((p ->> 'share_email_with_members')::boolean, false),
          not v_minor and coalesce((p ->> 'share_phone_with_members')::boolean, false),
          v_minor, public._hub_clean(p ->> 'notes_private', 2000), v_me)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.hub_update_person(p_person_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('admin');
  f jsonb := public._hub_person_fields(p);
  v_minor boolean := coalesce((p ->> 'is_under_18')::boolean, false);
  v_acc public.user_accounts%rowtype;
begin
  if not exists (select 1 from public.people where id = p_person_id) then perform public._fail('not_found'); end if;
  if f ->> 'email' is not null and exists (select 1 from public.people where id <> p_person_id
       and email_normalized operator(extensions.=) (f ->> 'email')::extensions.citext) then
    perform public._fail('duplicate_email', 'Someone else in the directory already has that email address.');
  end if;
  -- A linked sign-in is tied to the verified email: changing it would silently move the login.
  select * into v_acc from public.user_accounts where person_id = p_person_id;
  if v_acc.auth_user_id is not null and exists (select 1 from public.people where id = p_person_id
       and email_normalized is distinct from (f ->> 'email')::extensions.citext) then
    perform public._fail('email_locked', 'This person signs in with their current email address. Disable their access before changing it.');
  end if;
  if p_person_id = v_me and coalesce(p ->> 'lifecycle_status', 'active') <> 'active' then
    perform public._fail('self_lockout', 'You can''t make your own record inactive.');
  end if;
  update public.people set
    full_name = f ->> 'full_name',
    display_name = public._hub_clean(p ->> 'display_name', 80),
    email_normalized = (f ->> 'email')::extensions.citext,
    phone_normalized = f ->> 'phone',
    preferred_contact_channel = nullif(p ->> 'preferred_contact_channel', ''),
    involvement = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'involvement', '[]')) x), '{}'),
    routine_requests_enabled = coalesce((p ->> 'routine_requests_enabled')::boolean, false),
    directory_visibility = case when v_minor then 'private' else coalesce(nullif(p ->> 'directory_visibility', ''), 'members') end,
    share_email_with_members = not v_minor and coalesce((p ->> 'share_email_with_members')::boolean, false),
    share_phone_with_members = not v_minor and coalesce((p ->> 'share_phone_with_members')::boolean, false),
    is_under_18 = v_minor,
    notes_private = public._hub_clean(p ->> 'notes_private', 2000),
    lifecycle_status = coalesce(nullif(p ->> 'lifecycle_status', ''), lifecycle_status)
  where id = p_person_id;
end;
$$;

-- Interests, strengths and usual availability (admin for anyone; members for themselves).
create function public.hub_set_preferences(p_person_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('member');
begin
  if p_person_id <> v_me and not public.hub_is_admin() then perform public._fail('not_authorised'); end if;
  if not exists (select 1 from public.people where id = p_person_id) then perform public._fail('not_found'); end if;
  insert into public.volunteer_preferences as vp (person_id, commitment_bucket, commitment_pattern, location_preference,
                                                  willing_to_learn, strengths, interests, free_text, updated_at)
  values (p_person_id, nullif(p ->> 'commitment_bucket', ''), nullif(p ->> 'commitment_pattern', ''),
          nullif(p ->> 'location_preference', ''), nullif(p ->> 'willing_to_learn', ''),
          coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p -> 'strengths', '[]')) x), '{}'),
          coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p -> 'interests', '[]')) x), '{}'),
          public._hub_clean(p ->> 'free_text', 1000), now())
  on conflict (person_id) do update set
    commitment_bucket = excluded.commitment_bucket, commitment_pattern = excluded.commitment_pattern,
    location_preference = excluded.location_preference, willing_to_learn = excluded.willing_to_learn,
    strengths = excluded.strengths, interests = excluded.interests, free_text = excluded.free_text, updated_at = now();

  if p ? 'usual_availability' then
    delete from public.usual_availability where person_id = p_person_id;
    insert into public.usual_availability (person_id, day_of_week, daypart)
    select distinct p_person_id, (x ->> 'day')::smallint, x ->> 'daypart'
    from jsonb_array_elements(coalesce(p -> 'usual_availability', '[]')) x;
  end if;
end;
$$;

-- A member's own profile: name to show, phone, what they share. (Email is fixed to their sign-in.)
create function public.hub_update_my_profile(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('member');
  v_phone text := public._hub_normalize_phone(p ->> 'phone');
  v_minor boolean;
begin
  if v_phone is not null and v_phone !~ '^\+?[0-9]{6,15}$' then perform public._fail('invalid_phone', 'Enter a valid phone number, or leave it blank.'); end if;
  select is_under_18 into v_minor from public.people where id = v_me;
  update public.people set
    display_name = public._hub_clean(p ->> 'display_name', 80),
    phone_normalized = v_phone,
    preferred_contact_channel = nullif(p ->> 'preferred_contact_channel', ''),
    share_email_with_members = not v_minor and coalesce((p ->> 'share_email_with_members')::boolean, false),
    share_phone_with_members = not v_minor and coalesce((p ->> 'share_phone_with_members')::boolean, false)
  where id = v_me;
end;
$$;

-- ---------------------------------------------------------------------------
-- Teams and team roles (expected by role)
-- ---------------------------------------------------------------------------
create function public.hub_create_team(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text := public._hub_clean(p_name, 80);
begin
  perform public._hub_require('admin');
  if v_name is null then perform public._fail('invalid_name', 'Enter a team name.'); end if;
  insert into public.teams (name) values (v_name) returning id into v_id;
  return v_id;
end;
$$;

-- Create (p_id null) or update a person's team role. Ending a role sets active_to; history is kept.
create function public.hub_set_team_role(p_id uuid, p_person_id uuid, p_team_id uuid, p_role_label text,
                                         p_expected boolean, p_active_from date, p_active_to date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_label text := public._hub_clean(p_role_label, 60);
begin
  perform public._hub_require('admin');
  if v_label is null then perform public._fail('invalid_role', 'Give the role a name, e.g. Manager.'); end if;
  if p_active_to is not null and p_active_to < coalesce(p_active_from,
       (select tp.active_from from public.team_people tp where tp.id = p_id),
       (now() at time zone 'Europe/London')::date) then
    perform public._fail('invalid_dates', 'The end date must be on or after the start date.');
  end if;
  if p_id is null then
    if not exists (select 1 from public.people where id = p_person_id) then perform public._fail('not_found'); end if;
    if not exists (select 1 from public.teams where id = p_team_id) then perform public._fail('not_found'); end if;
    insert into public.team_people (team_id, person_id, role_label, is_expected_by_default, active_from, active_to)
    values (p_team_id, p_person_id, v_label, coalesce(p_expected, false),
            coalesce(p_active_from, (now() at time zone 'Europe/London')::date), p_active_to)
    returning id into v_id;
  else
    update public.team_people set role_label = v_label, is_expected_by_default = coalesce(p_expected, false),
           active_from = coalesce(p_active_from, active_from), active_to = p_active_to
     where id = p_id returning id into v_id;
    if v_id is null then perform public._fail('not_found'); end if;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal access: an explicit, separate admin action.
-- Prepares (or re-uses) the account row and returns what the server needs to send the Auth
-- invitation. Idempotent: an invite sent in the last 2 minutes is not sent again (double clicks).
-- Returns {status: ready|already_active|recently_sent, email}
-- ---------------------------------------------------------------------------
create function public.hub_prepare_portal_invite(p_person_id uuid, p_access_level text default 'member') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_person public.people%rowtype;
  v_acc public.user_accounts%rowtype;
begin
  perform public._hub_require('admin');
  if p_access_level not in ('admin', 'coordinator', 'member') then perform public._fail('invalid_access'); end if;
  select * into v_person from public.people where id = p_person_id for update;
  if not found then perform public._fail('not_found'); end if;
  if v_person.email_normalized is null then perform public._fail('email_required', 'Add an email address before sending a portal invitation.'); end if;
  if v_person.lifecycle_status <> 'active' then perform public._fail('person_inactive', 'Only active people can be invited.'); end if;
  if v_person.is_under_18 then perform public._fail('minor_no_portal', 'Under-18s aren''t invited to the portal in this version.'); end if;

  select * into v_acc from public.user_accounts where person_id = p_person_id for update;
  if found and v_acc.auth_user_id is not null and v_acc.enabled then
    return jsonb_build_object('status', 'already_active', 'email', v_person.email_normalized::text);
  end if;
  if found and v_acc.invite_state = 'sent' and v_acc.last_invite_at > now() - interval '2 minutes' then
    return jsonb_build_object('status', 'recently_sent', 'email', v_person.email_normalized::text);
  end if;

  insert into public.user_accounts (person_id, access_level, enabled, invited_at, invite_state, invite_attempts, last_invite_at)
  values (p_person_id, p_access_level, true, now(), 'not_sent', 1, now())
  on conflict (person_id) do update set
    access_level = case when public.user_accounts.access_level = 'admin' then 'admin' else excluded.access_level end,
    enabled = true, invited_at = coalesce(public.user_accounts.invited_at, now()),
    invite_attempts = public.user_accounts.invite_attempts + 1, last_invite_at = now();
  perform public._hub_audit('portal_invite_prepared', 'people', p_person_id, null,
                            jsonb_build_object('access_level', p_access_level), 'portal');
  return jsonb_build_object('status', 'ready', 'email', v_person.email_normalized::text);
end;
$$;

-- The server records what actually happened with the Auth invitation (never claims success early).
create function public.hub_record_invite_result(p_person_id uuid, p_state text, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._hub_require('admin');
  if p_state not in ('sent', 'failed', 'not_sent', 'manual') then perform public._fail('invalid_state'); end if;
  update public.user_accounts set invite_state = p_state, last_invite_error = left(p_error, 200), last_invite_at = now()
   where person_id = p_person_id;
  if not found then perform public._fail('not_found'); end if;
  perform public._hub_audit('portal_invite_' || p_state, 'people', p_person_id, null, null, 'portal');
end;
$$;

create function public.hub_set_access(p_person_id uuid, p_access_level text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('admin');
begin
  if p_access_level not in ('admin', 'coordinator', 'member') then perform public._fail('invalid_access'); end if;
  if not exists (select 1 from public.user_accounts where person_id = p_person_id) then
    perform public._fail('no_account', 'This person hasn''t been invited to the portal yet.');
  end if;
  if (p_access_level <> 'admin' or not p_enabled) and exists (select 1 from public.user_accounts where person_id = p_person_id and access_level = 'admin' and enabled)
     and (select count(*) from public.user_accounts ua join public.people p on p.id = ua.person_id
          where ua.access_level = 'admin' and ua.enabled and p.lifecycle_status = 'active' and ua.person_id <> p_person_id) = 0 then
    perform public._fail('last_admin', 'The club must keep at least one active administrator.');
  end if;
  update public.user_accounts set access_level = p_access_level, enabled = p_enabled where person_id = p_person_id;
end;
$$;

create function public.hub_set_coordinator_scopes(p_person_id uuid, p_venue_ids uuid[], p_team_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._hub_require('admin');
  delete from public.coordinator_scopes where person_id = p_person_id;
  insert into public.coordinator_scopes (person_id, venue_id)
    select p_person_id, v from unnest(coalesce(p_venue_ids, '{}')) v where exists (select 1 from public.venues where id = v);
  insert into public.coordinator_scopes (person_id, team_id)
    select p_person_id, t from unnest(coalesce(p_team_ids, '{}')) t where exists (select 1 from public.teams where id = t);
end;
$$;

-- First administrator, from a trusted machine with the secret key (scripts/invite-volunteer.mts).
create function public.hub_bootstrap_person(p_email text, p_full_name text, p_access_level text default 'member') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_id uuid;
  v_linked boolean;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then perform public._fail('invalid_email', 'Enter a valid email address.'); end if;
  if v_name = '' or length(v_name) > 120 then perform public._fail('invalid_name', 'Enter a name.'); end if;
  if p_access_level not in ('admin', 'coordinator', 'member') then perform public._fail('invalid_access'); end if;
  select id into v_id from public.people where email_normalized operator(extensions.=) v_email::extensions.citext;
  if v_id is null then
    insert into public.people (full_name, email_normalized, involvement) values (v_name, v_email, array['volunteer'])
    returning id into v_id;
  else
    update public.people set lifecycle_status = 'active' where id = v_id;
  end if;
  insert into public.user_accounts (person_id, access_level, enabled, invited_at, invite_state, last_invite_at)
  values (v_id, p_access_level, true, now(), 'sent', now())
  on conflict (person_id) do update set access_level = excluded.access_level, enabled = true,
    invited_at = coalesce(public.user_accounts.invited_at, now()), last_invite_at = now();
  select auth_user_id is not null into v_linked from public.user_accounts where person_id = v_id;
  return jsonb_build_object('person_id', v_id, 'already_linked', v_linked);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sanitised reads
-- ---------------------------------------------------------------------------
-- Directory. Members: listed people only, with contacts ONLY where shared. Organisers: everyone
-- active, with contact details. Admins additionally: portal and request settings.
create function public.hub_directory() returns table (
  person_id uuid, name text, involvement text[], teams jsonb, email text, phone text,
  portal_status text, routine_requests_enabled boolean, lifecycle_status text, is_under_18 boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_level text := public.current_access_level();
begin
  if public.current_person_id() is null then perform public._fail('not_authorised'); end if;
  return query
  select p.id, coalesce(p.display_name, p.full_name), p.involvement,
    coalesce((select jsonb_agg(jsonb_build_object('team', t.name, 'role', tp.role_label) order by t.name)
              from public.team_people tp join public.teams t on t.id = tp.team_id
              where tp.person_id = p.id and tp.active_from <= (now() at time zone 'Europe/London')::date
                and (tp.active_to is null or tp.active_to >= (now() at time zone 'Europe/London')::date)), '[]'::jsonb),
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

-- ---------------------------------------------------------------------------
-- Row level security (deny by default; writes only through the functions above)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['people', 'user_accounts', 'coordinator_scopes', 'team_people',
                           'volunteer_preferences', 'usual_availability']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

create policy people_read_self_or_admin on public.people for select to authenticated
  using (id = (select public.current_person_id()) or (select public.hub_is_admin()));
create policy user_accounts_read_self_or_admin on public.user_accounts for select to authenticated
  using (person_id = (select public.current_person_id()) or (select public.hub_is_admin()));
create policy coordinator_scopes_read on public.coordinator_scopes for select to authenticated
  using (person_id = (select public.current_person_id()) or (select public.hub_is_admin()));
create policy team_people_read on public.team_people for select to authenticated
  using (person_id = (select public.current_person_id()) or (select public.hub_is_manager()));
create policy volunteer_preferences_read on public.volunteer_preferences for select to authenticated
  using (person_id = (select public.current_person_id()) or (select public.hub_is_admin()));
create policy usual_availability_read on public.usual_availability for select to authenticated
  using (person_id = (select public.current_person_id()) or (select public.hub_is_admin()));

-- Reference data is also readable by Hub members (legacy policies only knew legacy volunteers).
create policy venues_read_hub on public.venues for select to authenticated
  using ((select public.current_person_id()) is not null);
create policy teams_read_hub on public.teams for select to authenticated
  using ((select public.current_person_id()) is not null);
create policy duty_types_read_hub on public.duty_types for select to authenticated
  using ((select public.current_person_id()) is not null);
create policy club_settings_read_hub on public.club_settings for select to authenticated
  using ((select public.current_person_id()) is not null);
create policy audit_log_hub_admin_read on public.audit_log for select to authenticated
  using ((select public.hub_is_admin()));

-- Hub administrators manage reference data too (the legacy policies only knew legacy admins).
create policy venues_hub_admin_insert on public.venues for insert to authenticated with check ((select public.hub_is_admin()));
create policy venues_hub_admin_update on public.venues for update to authenticated
  using ((select public.hub_is_admin())) with check ((select public.hub_is_admin()));
create policy teams_hub_admin_insert on public.teams for insert to authenticated with check ((select public.hub_is_admin()));
create policy teams_hub_admin_update on public.teams for update to authenticated
  using ((select public.hub_is_admin())) with check ((select public.hub_is_admin()));
create policy duty_types_hub_admin_update on public.duty_types for update to authenticated
  using ((select public.hub_is_admin())) with check ((select public.hub_is_admin()));
create policy club_settings_hub_admin_update on public.club_settings for update to authenticated
  using ((select public.hub_is_admin())) with check ((select public.hub_is_admin()));

-- Functions: nothing for anon; an explicit allow-list for signed-in users; one for the secret key.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.current_person_id(), public.current_access_level(), public.hub_is_admin(), public.hub_is_manager(),
  public.hub_can_manage_venue(uuid), public.hub_can_manage_team(uuid),
  public.link_person_account(), public.hub_me(),
  public.hub_create_person(jsonb), public.hub_update_person(uuid, jsonb), public.hub_set_preferences(uuid, jsonb),
  public.hub_update_my_profile(jsonb), public.hub_create_team(text),
  public.hub_set_team_role(uuid, uuid, uuid, text, boolean, date, date),
  public.hub_prepare_portal_invite(uuid, text), public.hub_record_invite_result(uuid, text, text),
  public.hub_set_access(uuid, text, boolean), public.hub_set_coordinator_scopes(uuid, uuid[], uuid[]),
  public.hub_directory()
to authenticated;
revoke execute on function public._hub_require(text), public._hub_audit(text, text, uuid, jsonb, jsonb, text),
  public._hub_person_fields(jsonb), public._hub_normalize_phone(text), public._hub_clean(text, int),
  public.hub_bootstrap_person(text, text, text) from authenticated, service_role;
grant execute on function public.hub_bootstrap_person(text, text, text) to service_role;
