-- Cinque Ports FC Volunteer Hub: apply all 8 Hub database changes to the live project in ONE transaction.
-- Paste the whole file into Supabase -> Cinque Ports Rota -> SQL Editor -> Run.
-- If anything fails, the whole thing is rolled back and nothing changes.
-- Generated from supabase/migrations/20261019000100..0800 (unchanged copies) on 19 Oct 2026.
begin;

-- ====================================================================== 20261019000100_hub_people
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261019000100', 'hub_people') on conflict (version) do nothing;

-- ====================================================================== 20261019000200_hub_calendar
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261019000200', 'hub_calendar') on conflict (version) do nothing;

-- ====================================================================== 20261019000300_hub_availability
-- Volunteer Hub · Stage 3: event availability, targeted requests, direct invitations, expected by role.
-- Four separate ideas, never conflated:
--   availability_requests  = "we asked you"            (only these people can be "Not replied")
--   event_availability     = "I could help" (yes/no)   (a reply, NOT an assignment)
--   hub_assignments        = "will you do X?"          (pending until accepted, or recorded by an organiser)
--   expected by role       = derived from team_people  (expected, never "confirmed")
-- ADDITIVE ONLY. Rollback: docs/sql/rollback-20261019000300.sql

create table public.availability_requests (
  id                      uuid primary key default gen_random_uuid(),
  event_id                uuid not null references public.events (id) on delete cascade,
  person_id               uuid not null references public.people (id) on delete cascade,
  requested_by_person_id  uuid references public.people (id) on delete set null,
  requested_at            timestamptz not null default now(),
  delivery_state          text not null default 'not_sent' check (delivery_state in ('not_sent', 'queued', 'sent', 'failed', 'manual_contact')),
  sent_at                 timestamptz,
  unique (event_id, person_id)
);
create index availability_requests_person_idx on public.availability_requests (person_id);

create table public.event_availability (
  id                     uuid primary key default gen_random_uuid(),
  event_id               uuid not null references public.events (id) on delete cascade,
  person_id              uuid not null references public.people (id) on delete cascade,
  response               text not null check (response in ('yes', 'no')),
  for_full_event         boolean not null default false,
  available_from         timestamptz,
  available_until        timestamptz,
  -- A partial window on an event with no recorded finish can't be checked: an organiser should look.
  needs_admin_check      boolean not null default false,
  response_source        text not null check (response_source in ('self', 'admin_recorded')),
  recorded_by_person_id  uuid references public.people (id) on delete set null,
  responded_at           timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (event_id, person_id),
  constraint event_availability_shape check (
    (response = 'no' and not for_full_event and available_from is null and available_until is null)
    or (response = 'yes' and for_full_event and available_from is null and available_until is null)
    or (response = 'yes' and not for_full_event and available_from is not null and available_until is not null and available_from < available_until)),
  constraint event_availability_recorded_by check (response_source = 'self' or recorded_by_person_id is not null)
);
create index event_availability_person_idx on public.event_availability (person_id);

create table public.hub_assignments (
  id                      uuid primary key default gen_random_uuid(),
  person_id               uuid not null references public.people (id) on delete restrict,
  scope                   text not null check (scope in ('event', 'venue')),
  event_id                uuid references public.events (id) on delete restrict,
  venue_id                uuid references public.venues (id) on delete restrict,
  responsibility_label    text check (responsibility_label is null or char_length(btrim(responsibility_label)) between 1 and 80),
  begins_at               timestamptz,
  ends_at                 timestamptz,
  state                   text not null default 'pending'
                            check (state in ('pending', 'confirmed', 'declined', 'cancelled', 'needs_reconfirmation')),
  invitation_source       text not null check (invitation_source in ('portal', 'email', 'offline')),
  response_source         text check (response_source in ('self', 'admin_recorded')),
  recorded_by_person_id   uuid references public.people (id) on delete set null,
  requested_by_person_id  uuid references public.people (id) on delete set null,
  responded_at            timestamptz,
  cancel_reason           text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  conflict_override_note  text check (conflict_override_note is null or char_length(conflict_override_note) <= 500),
  notes_private           text check (notes_private is null or char_length(notes_private) <= 1000),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint hub_assignments_scope_target check (
    (scope = 'event' and event_id is not null and venue_id is null)
    or (scope = 'venue' and venue_id is not null and event_id is null and begins_at is not null and ends_at is not null)),
  constraint hub_assignments_times check (begins_at is null or ends_at is null or begins_at < ends_at),
  constraint hub_assignments_max_length check (begins_at is null or ends_at is null or ends_at - begins_at <= interval '24 hours'),
  -- "Confirmed" is only ever set by the person or recorded by an organiser, with attribution.
  constraint hub_assignments_confirmation_attributed check (
    state not in ('confirmed', 'declined') or response_source is not null),
  constraint hub_assignments_admin_attributed check (response_source is distinct from 'admin_recorded' or recorded_by_person_id is not null)
);
-- One live request per person per event and responsibility (double clicks can't duplicate).
create unique index hub_assignments_event_live_uq on public.hub_assignments (event_id, person_id, coalesce(lower(responsibility_label), ''))
  where scope = 'event' and state in ('pending', 'confirmed', 'needs_reconfirmation');
create index hub_assignments_person_idx on public.hub_assignments (person_id, state);
create index hub_assignments_event_idx on public.hub_assignments (event_id) where event_id is not null;
create index hub_assignments_venue_idx on public.hub_assignments (venue_id, begins_at) where venue_id is not null;

create table public.event_participation_exceptions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  person_id       uuid not null references public.people (id) on delete cascade,
  team_person_id  uuid references public.team_people (id) on delete set null,
  override        text not null check (override in ('not_expected', 'confirmed_by_person', 'confirmed_by_admin')),
  recorded_by     uuid references public.people (id) on delete set null,
  note            text check (note is null or char_length(note) <= 300),
  created_at      timestamptz not null default now(),
  unique (event_id, person_id)
);

do $$
declare t text;
begin
  foreach t in array array['event_availability', 'hub_assignments']
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
  foreach t in array array['availability_requests', 'event_availability', 'hub_assignments', 'event_participation_exceptions']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- RLS: your own rows, or the organisers who manage the event/venue. Writes only via functions.
create policy availability_requests_read on public.availability_requests for select to authenticated
  using (person_id = (select public.current_person_id()) or public.hub_can_manage_event(event_id));
create policy event_availability_read on public.event_availability for select to authenticated
  using (person_id = (select public.current_person_id()) or public.hub_can_manage_event(event_id));
create policy hub_assignments_read on public.hub_assignments for select to authenticated
  using (person_id = (select public.current_person_id())
         or (scope = 'event' and public.hub_can_manage_event(event_id))
         or (scope = 'venue' and public.hub_can_manage_venue(venue_id)));
create policy event_participation_exceptions_read on public.event_participation_exceptions for select to authenticated
  using (person_id = (select public.current_person_id()) or public.hub_can_manage_event(event_id));

-- ---------------------------------------------------------------------------
-- Notification hook. Stage 3: records the intent only and reports "not_sent" (nothing is emailed).
-- Stage 7 replaces this with the real outbox (explicit actions only, idempotent).
-- ---------------------------------------------------------------------------
create function public._hub_notify(p_kind text, p_person_id uuid, p_entity_type text, p_entity_id uuid,
                                   p_payload jsonb default '{}'::jsonb, p_key text default null)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  return 'not_sent';
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public._hub_event_open(p_event public.events) returns boolean
language sql stable set search_path = '' as $$
  select p_event.status in ('published', 'postponed') and coalesce(p_event.ends_at, p_event.starts_at + interval '6 hours') > now()
$$;

-- ---------------------------------------------------------------------------
-- Availability: explicit request (organiser reviews recipients, then presses Send)
-- ---------------------------------------------------------------------------
create function public.hub_request_availability(p_event_id uuid, p_person_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_event public.events%rowtype;
  v_pid uuid;
  v_new int := 0;
  v_existing int := 0;
  v_state text;
  v_rid uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if not v_event.volunteers_enabled then perform public._fail('volunteers_not_enabled', 'Turn on “Ask volunteers for availability?” for this event first.'); end if;
  if v_event.status <> 'published' then perform public._fail('event_not_open', 'Publish the event first, so the people you ask can see it.'); end if;
  if not public._hub_event_open(v_event) then perform public._fail('event_not_open', 'This event has finished.'); end if;
  if coalesce(cardinality(p_person_ids), 0) = 0 then perform public._fail('no_recipients', 'Choose at least one person.'); end if;
  if cardinality(p_person_ids) > 200 then perform public._fail('too_many', 'Choose up to 200 people at a time.'); end if;

  foreach v_pid in array (select array_agg(distinct x) from unnest(p_person_ids) x) loop
    if not exists (select 1 from public.people where id = v_pid and lifecycle_status = 'active') then continue; end if;
    insert into public.availability_requests (event_id, person_id, requested_by_person_id)
    values (p_event_id, v_pid, v_me)
    on conflict (event_id, person_id) do nothing
    returning id into v_rid;
    if v_rid is null then
      v_existing := v_existing + 1;
    else
      v_new := v_new + 1;
      v_state := public._hub_notify('availability_request', v_pid, 'availability_requests', v_rid,
                                    jsonb_build_object('event_id', p_event_id), 'availability_request:' || v_rid);
      update public.availability_requests set delivery_state = v_state,
             sent_at = case when v_state in ('queued', 'sent') then now() end where id = v_rid;
    end if;
    v_rid := null;
  end loop;
  return jsonb_build_object('requested', v_new, 'already_asked', v_existing);
end;
$$;

-- Organiser contacted someone another way (phone, in person): mark the request as manual contact.
create function public.hub_mark_request_contacted(p_event_id uuid, p_person_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('manager');
begin
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  insert into public.availability_requests (event_id, person_id, requested_by_person_id, delivery_state)
  values (p_event_id, p_person_id, v_me, 'manual_contact')
  on conflict (event_id, person_id) do update set delivery_state = 'manual_contact';
end;
$$;

-- Validate and save a reply (shared by the person and organisers).
create function public._hub_save_availability(p_event_id uuid, p_person_id uuid, p_response text, p_full boolean,
                                              p_from timestamptz, p_until timestamptz, p_source text, p_recorder uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_check boolean := false;
  v_full boolean := coalesce(p_full, false);
begin
  select * into v_event from public.events where id = p_event_id for share;
  if not found then perform public._fail('not_found'); end if;
  if not v_event.volunteers_enabled then perform public._fail('volunteers_not_enabled', 'This event isn''t asking for volunteers.'); end if;
  if not public._hub_event_open(v_event) then perform public._fail('event_not_open', 'This event isn''t open for replies.'); end if;
  if p_response not in ('yes', 'no') then perform public._fail('invalid_response'); end if;
  if p_response = 'no' then
    v_full := false; p_from := null; p_until := null;
  elsif v_full then
    p_from := null; p_until := null;
  else
    if p_from is null or p_until is null then perform public._fail('times_required', 'Choose from and until times, or “Whole event”.'); end if;
    if p_from >= p_until then perform public._fail('invalid_times', 'The “until” time must be after the “from” time.'); end if;
    if p_until - p_from > interval '24 hours' then perform public._fail('invalid_times', 'That''s longer than a day.'); end if;
    if p_from < v_event.starts_at - interval '3 hours' then perform public._fail('outside_event', 'Those times are well before the event starts.'); end if;
    if v_event.ends_at is not null then
      if p_from >= v_event.ends_at or p_until > v_event.ends_at + interval '3 hours' then
        perform public._fail('outside_event', 'Those times are outside the event.');
      end if;
    else
      -- Finish not recorded: we can't check the end, so an organiser takes a look.
      if p_from > v_event.starts_at + interval '12 hours' then perform public._fail('outside_event', 'Those times are outside the event.'); end if;
      v_check := true;
    end if;
  end if;
  insert into public.event_availability (event_id, person_id, response, for_full_event, available_from, available_until,
                                         needs_admin_check, response_source, recorded_by_person_id, responded_at)
  values (p_event_id, p_person_id, p_response, v_full, p_from, p_until, v_check, p_source, p_recorder, now())
  on conflict (event_id, person_id) do update set
    response = excluded.response, for_full_event = excluded.for_full_event, available_from = excluded.available_from,
    available_until = excluded.available_until, needs_admin_check = excluded.needs_admin_check,
    response_source = excluded.response_source, recorded_by_person_id = excluded.recorded_by_person_id, responded_at = now();
  return jsonb_build_object('response', p_response, 'needs_admin_check', v_check, 'full_event_end_unknown', v_full and v_event.ends_at is null);
end;
$$;

-- The signed-in person answers "Can you help?" for an event that asks for volunteers.
create function public.hub_respond_availability(p_event_id uuid, p_response text, p_full boolean default true,
                                                p_from timestamptz default null, p_until timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('member');
begin
  if not exists (select 1 from public.events e where e.id = p_event_id and (e.status <> 'draft' or public.hub_can_manage_event(e.id))) then
    perform public._fail('not_found');
  end if;
  return public._hub_save_availability(p_event_id, v_me, p_response, p_full, p_from, p_until, 'self', null);
end;
$$;

-- An organiser records a reply given offline (phone, in person) — labelled "Recorded by organiser".
create function public.hub_record_availability(p_event_id uuid, p_person_id uuid, p_response text, p_full boolean default true,
                                               p_from timestamptz default null, p_until timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('manager');
begin
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if not exists (select 1 from public.people where id = p_person_id and lifecycle_status = 'active') then perform public._fail('not_found'); end if;
  return public._hub_save_availability(p_event_id, p_person_id, p_response, p_full, p_from, p_until, 'admin_recorded', v_me);
end;
$$;

-- ---------------------------------------------------------------------------
-- Direct invitations / assignments for one event
-- p_mode: 'request' (pending until they accept) | 'record_confirmed' (organiser records an offline yes)
-- Works for anyone in the directory, including people who don't get routine requests (explicit one-off).
-- ---------------------------------------------------------------------------
create function public.hub_invite_to_help(p_event_id uuid, p_person_id uuid, p_label text default null,
                                          p_begins timestamptz default null, p_ends timestamptz default null,
                                          p_mode text default 'request')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_event public.events%rowtype;
  v_label text := public._hub_clean(p_label, 80);
  v_has_account boolean;
  v_existing public.hub_assignments%rowtype;
  v_id uuid;
  v_delivery text := 'not_sent';
begin
  if p_mode not in ('request', 'record_confirmed') then perform public._fail('invalid_mode'); end if;
  select * into v_event from public.events where id = p_event_id for share;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if v_event.status in ('cancelled', 'completed') then perform public._fail('event_not_open', 'This event is ' || v_event.status || '.'); end if;
  if not exists (select 1 from public.people where id = p_person_id and lifecycle_status = 'active') then perform public._fail('not_found'); end if;
  if p_begins is not null and p_ends is not null and p_begins >= p_ends then perform public._fail('invalid_times', 'The finish must be after the start.'); end if;
  if p_mode = 'request' and v_event.status = 'draft' then
    perform public._fail('event_not_open', 'Publish the event before asking people, so they can see it.');
  end if;

  select * into v_existing from public.hub_assignments
   where scope = 'event' and event_id = p_event_id and person_id = p_person_id
     and coalesce(lower(responsibility_label), '') = coalesce(lower(v_label), '')
     and state in ('pending', 'confirmed', 'needs_reconfirmation')
   for update;
  if found then
    if p_mode = 'record_confirmed' and v_existing.state <> 'confirmed' then
      update public.hub_assignments set state = 'confirmed', response_source = 'admin_recorded', recorded_by_person_id = v_me, responded_at = now()
       where id = v_existing.id;
      return jsonb_build_object('assignment_id', v_existing.id, 'status', 'recorded_confirmed', 'existing', true);
    end if;
    return jsonb_build_object('assignment_id', v_existing.id, 'status', 'already_' || v_existing.state, 'existing', true);
  end if;

  select exists (select 1 from public.user_accounts ua where ua.person_id = p_person_id and ua.enabled and ua.auth_user_id is not null)
    into v_has_account;
  insert into public.hub_assignments (person_id, scope, event_id, responsibility_label, begins_at, ends_at, state,
                                      invitation_source, response_source, recorded_by_person_id, requested_by_person_id, responded_at)
  values (p_person_id, 'event', p_event_id, v_label, p_begins, p_ends,
          case when p_mode = 'record_confirmed' then 'confirmed' else 'pending' end,
          case when p_mode = 'record_confirmed' or not v_has_account then 'offline' else 'portal' end,
          case when p_mode = 'record_confirmed' then 'admin_recorded' end,
          case when p_mode = 'record_confirmed' then v_me end, v_me,
          case when p_mode = 'record_confirmed' then now() end)
  returning id into v_id;
  if p_mode = 'request' and v_has_account then
    v_delivery := public._hub_notify('assignment_request', p_person_id, 'hub_assignments', v_id,
                                     jsonb_build_object('event_id', p_event_id), 'assignment_request:' || v_id);
  end if;
  return jsonb_build_object('assignment_id', v_id, 'status', case when p_mode = 'record_confirmed' then 'recorded_confirmed' else 'pending' end,
                            'has_account', v_has_account, 'delivery', v_delivery, 'existing', false);
end;
$$;

-- The person accepts or declines (idempotent: accepting twice stays confirmed once).
create function public.hub_respond_assignment(p_assignment_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('member');
  v_a public.hub_assignments%rowtype;
  v_new text := case when p_accept then 'confirmed' else 'declined' end;
begin
  select * into v_a from public.hub_assignments where id = p_assignment_id for update;
  if not found or v_a.person_id <> v_me then perform public._fail('not_found'); end if;
  if v_a.state = v_new then return v_new; end if;
  if v_a.state not in ('pending', 'needs_reconfirmation') then
    perform public._fail('invalid_transition', 'This request has already been ' || v_a.state || '.');
  end if;
  update public.hub_assignments set state = v_new, response_source = 'self', recorded_by_person_id = null, responded_at = now()
   where id = p_assignment_id;
  perform public._hub_notify('assignment_' || v_new, v_a.requested_by_person_id, 'hub_assignments', p_assignment_id,
                             jsonb_build_object('person_id', v_me), 'assignment_response:' || p_assignment_id || ':' || v_new || ':' || extract(epoch from now())::bigint);
  return v_new;
end;
$$;

-- The person can step back from something they had confirmed.
create function public.hub_withdraw_assignment(p_assignment_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('member');
  v_a public.hub_assignments%rowtype;
begin
  select * into v_a from public.hub_assignments where id = p_assignment_id for update;
  if not found or v_a.person_id <> v_me then perform public._fail('not_found'); end if;
  if v_a.state = 'cancelled' then return; end if;
  if v_a.state not in ('confirmed', 'needs_reconfirmation', 'pending') then perform public._fail('invalid_transition'); end if;
  update public.hub_assignments set state = 'cancelled', cancel_reason = coalesce(public._hub_clean(p_reason, 500), 'Withdrawn by the volunteer'),
         response_source = 'self', responded_at = now() where id = p_assignment_id;
  perform public._hub_notify('assignment_withdrawn', v_a.requested_by_person_id, 'hub_assignments', p_assignment_id, '{}'::jsonb,
                             'assignment_withdrawn:' || p_assignment_id);
end;
$$;

create function public._hub_can_manage_assignment(p_a public.hub_assignments) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_a.scope when 'event' then public.hub_can_manage_event(p_a.event_id) else public.hub_can_manage_venue(p_a.venue_id) end
$$;

-- Organiser records the person's answer given offline ("Confirmed by organiser" / declined).
create function public.hub_record_assignment_response(p_assignment_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_a public.hub_assignments%rowtype;
  v_new text := case when p_accept then 'confirmed' else 'declined' end;
begin
  select * into v_a from public.hub_assignments where id = p_assignment_id for update;
  if not found then perform public._fail('not_found'); end if;
  if not public._hub_can_manage_assignment(v_a) then perform public._fail('not_authorised'); end if;
  if v_a.state = v_new then return v_new; end if;
  if v_a.state not in ('pending', 'needs_reconfirmation') then perform public._fail('invalid_transition', 'This is already ' || v_a.state || '.'); end if;
  update public.hub_assignments set state = v_new, response_source = 'admin_recorded', recorded_by_person_id = v_me, responded_at = now()
   where id = p_assignment_id;
  return v_new;
end;
$$;

create function public.hub_cancel_assignment(p_assignment_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_a public.hub_assignments%rowtype;
begin
  select * into v_a from public.hub_assignments where id = p_assignment_id for update;
  if not found then perform public._fail('not_found'); end if;
  if not public._hub_can_manage_assignment(v_a) then perform public._fail('not_authorised'); end if;
  if v_a.state = 'cancelled' then return; end if;
  if v_a.state = 'declined' then perform public._fail('invalid_transition', 'They already declined.'); end if;
  update public.hub_assignments set state = 'cancelled', cancel_reason = coalesce(public._hub_clean(p_reason, 500), 'Cancelled by an organiser'),
         recorded_by_person_id = v_me where id = p_assignment_id;
  if v_a.state in ('confirmed', 'needs_reconfirmation', 'pending') then
    perform public._hub_notify('assignment_cancelled', v_a.person_id, 'hub_assignments', p_assignment_id, '{}'::jsonb,
                               'assignment_cancelled:' || p_assignment_id);
  end if;
end;
$$;

-- Ask again after an organiser-led change (resets a declined/cancelled person? no — a new request is a new row).

-- ---------------------------------------------------------------------------
-- Expected by role: per-event override (e.g. manager away this week). Never edits the team role.
-- p_override: 'not_expected' | 'confirmed_by_admin' | null (clear)
-- ---------------------------------------------------------------------------
create function public.hub_set_expected_override(p_event_id uuid, p_person_id uuid, p_override text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('manager');
begin
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if p_override is null then
    delete from public.event_participation_exceptions where event_id = p_event_id and person_id = p_person_id;
    return;
  end if;
  if p_override not in ('not_expected', 'confirmed_by_admin') then perform public._fail('invalid_override'); end if;
  insert into public.event_participation_exceptions (event_id, person_id, override, recorded_by, note,
    team_person_id)
  values (p_event_id, p_person_id, p_override, v_me, public._hub_clean(p_note, 300),
    (select tp.id from public.team_people tp join public.events e on e.team_id = tp.team_id
      where e.id = p_event_id and tp.person_id = p_person_id order by tp.active_from desc limit 1))
  on conflict (event_id, person_id) do update set override = excluded.override, recorded_by = v_me, note = excluded.note, created_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Material event change → confirmed people must reconfirm; cancelled event → open requests closed.
-- (Replaces the Stage 2 no-op hooks.)
-- ---------------------------------------------------------------------------
create or replace function public._hub_after_event_change(p_event_id uuid, p_material boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not p_material then return; end if;
  for r in update public.hub_assignments set state = 'needs_reconfirmation'
            where scope = 'event' and event_id = p_event_id and state = 'confirmed'
            returning id, person_id
  loop
    perform public._hub_notify('assignment_reconfirm', r.person_id, 'hub_assignments', r.id,
                               jsonb_build_object('event_id', p_event_id), 'assignment_reconfirm:' || r.id || ':' || extract(epoch from now())::bigint);
  end loop;
end;
$$;

create or replace function public._hub_after_event_cancel(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in update public.hub_assignments set state = 'cancelled', cancel_reason = 'The event was cancelled'
            where scope = 'event' and event_id = p_event_id and state in ('pending', 'confirmed', 'needs_reconfirmation')
            returning id, person_id
  loop
    perform public._hub_notify('event_cancelled', r.person_id, 'hub_assignments', r.id,
                               jsonb_build_object('event_id', p_event_id), 'event_cancelled:' || r.id);
  end loop;
end;
$$;

-- hub_update_event now also reports how many people need to reconfirm.
create or replace function public.hub_update_event(p_event_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_old public.events%rowtype;
  f jsonb;
  v_material boolean;
  v_before int;
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
  select count(*) into v_before from public.hub_assignments where scope = 'event' and event_id = p_event_id and state = 'confirmed';
  perform public._hub_after_event_change(p_event_id, v_material);
  return jsonb_build_object('material', v_material, 'reconfirm', case when v_material then v_before else 0 end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
-- Everyone involved with one event. Members get sections 1–4 (no contact details); organisers also
-- get requests, non-replies, declines and contact details.
create function public.hub_event_involvement(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.current_person_id();
  v_mgr boolean;
  v_event public.events%rowtype;
  v_day date;
begin
  if v_me is null then perform public._fail('not_authorised'); end if;
  select * into v_event from public.events where id = p_event_id;
  if not found or (v_event.status = 'draft' and not public.hub_can_manage_event(p_event_id)) then perform public._fail('not_found'); end if;
  v_mgr := public.hub_can_manage_event(p_event_id);
  v_day := (v_event.starts_at at time zone 'Europe/London')::date;
  return jsonb_build_object(
    'can_manage', v_mgr,
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'person_id', a.person_id, 'name', coalesce(p.display_name, p.full_name), 'label', a.responsibility_label,
        'begins_at', a.begins_at, 'ends_at', a.ends_at, 'state', a.state, 'response_source', a.response_source,
        'invitation_source', a.invitation_source, 'responded_at', a.responded_at, 'cancel_reason', case when v_mgr then a.cancel_reason end,
        'recorded_by', case when v_mgr then (select coalesce(r.display_name, r.full_name) from public.people r where r.id = a.recorded_by_person_id) end,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by a.state, a.begins_at nulls first)
      from public.hub_assignments a join public.people p on p.id = a.person_id
      where a.scope = 'event' and a.event_id = p_event_id
        and (v_mgr or a.state in ('confirmed', 'needs_reconfirmation') or a.person_id = v_me)), '[]'::jsonb),
    'expected', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', tp.person_id, 'name', coalesce(p.display_name, p.full_name), 'role', tp.role_label,
        'override', x.override, 'override_note', case when v_mgr then x.note end,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by tp.role_label, p.full_name)
      from public.team_people tp join public.people p on p.id = tp.person_id
      left join public.event_participation_exceptions x on x.event_id = p_event_id and x.person_id = tp.person_id
      where v_event.team_id is not null and tp.team_id = v_event.team_id and tp.is_expected_by_default
        and p.lifecycle_status = 'active' and tp.active_from <= v_day and (tp.active_to is null or tp.active_to >= v_day)
        and (v_mgr or x.override is distinct from 'not_expected')), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', ea.person_id, 'name', coalesce(p.display_name, p.full_name), 'response', ea.response,
        'for_full_event', ea.for_full_event, 'available_from', ea.available_from, 'available_until', ea.available_until,
        'needs_admin_check', case when v_mgr then ea.needs_admin_check end, 'response_source', ea.response_source,
        'recorded_by', case when v_mgr then (select coalesce(r.display_name, r.full_name) from public.people r where r.id = ea.recorded_by_person_id) end,
        'responded_at', ea.responded_at,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by ea.responded_at)
      from public.event_availability ea join public.people p on p.id = ea.person_id
      where ea.event_id = p_event_id and (v_mgr or ea.response = 'yes' or ea.person_id = v_me)), '[]'::jsonb),
    'requests', case when v_mgr then coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', r.person_id, 'name', coalesce(p.display_name, p.full_name), 'requested_at', r.requested_at,
        'delivery_state', r.delivery_state, 'replied', exists (select 1 from public.event_availability ea where ea.event_id = r.event_id and ea.person_id = r.person_id),
        'email', p.email_normalized::text, 'phone', p.phone_normalized) order by p.full_name)
      from public.availability_requests r join public.people p on p.id = r.person_id
      where r.event_id = p_event_id), '[]'::jsonb) else '[]'::jsonb end,
    'my_request', exists (select 1 from public.availability_requests r where r.event_id = p_event_id and r.person_id = v_me));
end;
$$;

-- Recipient picker for "Request availability": everyone active and over 18, with the routine
-- preference used ONLY to pre-tick. Nothing is sent from here.
create function public.hub_request_candidates(p_event_id uuid) returns table (
  person_id uuid, name text, suggested boolean, reason text, already_asked boolean, replied text, has_account boolean, has_email boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_event public.events%rowtype;
begin
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  select * into v_event from public.events where id = p_event_id;
  return query
  select p.id, coalesce(p.display_name, p.full_name),
    p.routine_requests_enabled,
    case when p.routine_requests_enabled then 'Usually asked' else null end,
    exists (select 1 from public.availability_requests r where r.event_id = p_event_id and r.person_id = p.id),
    (select ea.response from public.event_availability ea where ea.event_id = p_event_id and ea.person_id = p.id),
    exists (select 1 from public.user_accounts ua where ua.person_id = p.id and ua.enabled and ua.auth_user_id is not null),
    p.email_normalized is not null
  from public.people p
  where p.lifecycle_status = 'active' and not p.is_under_18
  order by p.routine_requests_enabled desc, lower(coalesce(p.display_name, p.full_name));
end;
$$;

-- People an organiser can invite or record for (picker), with contact details for offline contact.
create function public.hub_people_picker() returns table (person_id uuid, name text, has_account boolean, email text, phone text, routine boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.hub_is_manager() then perform public._fail('not_authorised'); end if;
  return query
  select p.id, coalesce(p.display_name, p.full_name),
    exists (select 1 from public.user_accounts ua where ua.person_id = p.id and ua.enabled and ua.auth_user_id is not null),
    p.email_normalized::text, p.phone_normalized, p.routine_requests_enabled
  from public.people p where p.lifecycle_status = 'active'
  order by lower(coalesce(p.display_name, p.full_name));
end;
$$;

-- The signed-in person's Home: what needs a reply, what they've agreed to, what's on.
create function public.hub_my_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('member');
begin
  return jsonb_build_object(
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'state', a.state, 'label', a.responsibility_label, 'begins_at', a.begins_at, 'ends_at', a.ends_at,
        'scope', a.scope, 'event_id', a.event_id, 'event_title', e.title, 'event_starts_at', e.starts_at, 'event_ends_at', e.ends_at,
        'venue_id', coalesce(a.venue_id, e.venue_id), 'external_location_text', e.external_location_text) order by coalesce(a.begins_at, e.starts_at))
      from public.hub_assignments a left join public.events e on e.id = a.event_id
      where a.person_id = v_me and a.state in ('pending', 'needs_reconfirmation')
        and coalesce(a.ends_at, e.ends_at, e.starts_at + interval '6 hours', a.begins_at + interval '6 hours') > now()
        and (e.id is null or e.status not in ('cancelled', 'draft'))), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
        'kickoff_at', e.kickoff_at, 'venue_id', e.venue_id, 'external_location_text', e.external_location_text) order by e.starts_at)
      from public.availability_requests r join public.events e on e.id = r.event_id
      where r.person_id = v_me and e.status = 'published' and e.volunteers_enabled and public._hub_event_open(e)
        and not exists (select 1 from public.event_availability ea where ea.event_id = e.id and ea.person_id = v_me)), '[]'::jsonb),
    'commitments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.responsibility_label, 'begins_at', a.begins_at, 'ends_at', a.ends_at,
        'scope', a.scope, 'event_id', a.event_id, 'event_title', e.title, 'event_starts_at', e.starts_at, 'event_ends_at', e.ends_at,
        'venue_id', coalesce(a.venue_id, e.venue_id), 'external_location_text', e.external_location_text, 'response_source', a.response_source)
        order by coalesce(a.begins_at, e.starts_at))
      from public.hub_assignments a left join public.events e on e.id = a.event_id
      where a.person_id = v_me and a.state = 'confirmed'
        and coalesce(a.ends_at, e.ends_at, e.starts_at + interval '6 hours') > now()
        and (e.id is null or e.status not in ('cancelled', 'draft'))), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', ea.event_id, 'response', ea.response))
      from public.event_availability ea join public.events e on e.id = ea.event_id
      where ea.person_id = v_me and e.starts_at > now() - interval '1 day'), '[]'::jsonb));
end;
$$;

-- Organiser "Requests" view: invitations awaiting an answer and availability not yet replied.
create function public.hub_open_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._hub_require('manager');
  return jsonb_build_object(
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'state', a.state, 'name', coalesce(p.display_name, p.full_name), 'person_id', a.person_id,
        'label', a.responsibility_label, 'scope', a.scope, 'event_id', a.event_id, 'event_title', e.title,
        'starts_at', coalesce(a.begins_at, e.starts_at), 'venue_id', coalesce(a.venue_id, e.venue_id), 'invitation_source', a.invitation_source,
        'created_at', a.created_at, 'phone', p.phone_normalized, 'email', p.email_normalized::text) order by coalesce(a.begins_at, e.starts_at))
      from public.hub_assignments a join public.people p on p.id = a.person_id left join public.events e on e.id = a.event_id
      where a.state in ('pending', 'needs_reconfirmation')
        and coalesce(a.ends_at, e.ends_at, e.starts_at + interval '6 hours', a.begins_at + interval '6 hours') > now()
        and public._hub_can_manage_assignment(a)), '[]'::jsonb),
    'unanswered', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'asked', x.asked, 'unanswered', x.unanswered)
        order by e.starts_at)
      from (select r.event_id, count(*) asked,
                   count(*) filter (where not exists (select 1 from public.event_availability ea where ea.event_id = r.event_id and ea.person_id = r.person_id)) unanswered
              from public.availability_requests r group by r.event_id) x
      join public.events e on e.id = x.event_id
      where x.unanswered > 0 and e.status = 'published' and public._hub_event_open(e) and public.hub_can_manage_event(e.id)), '[]'::jsonb));
end;
$$;

grant execute on function
  public.hub_request_availability(uuid, uuid[]), public.hub_mark_request_contacted(uuid, uuid),
  public.hub_respond_availability(uuid, text, boolean, timestamptz, timestamptz),
  public.hub_record_availability(uuid, uuid, text, boolean, timestamptz, timestamptz),
  public.hub_invite_to_help(uuid, uuid, text, timestamptz, timestamptz, text),
  public.hub_respond_assignment(uuid, boolean), public.hub_withdraw_assignment(uuid, text),
  public.hub_record_assignment_response(uuid, boolean), public.hub_cancel_assignment(uuid, text),
  public.hub_set_expected_override(uuid, uuid, text, text),
  public.hub_event_involvement(uuid), public.hub_request_candidates(uuid), public.hub_people_picker(),
  public.hub_my_home(), public.hub_open_requests()
to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261019000300', 'hub_availability') on conflict (version) do nothing;

-- ====================================================================== 20261019000400_hub_venue_cover
-- Volunteer Hub · Stage 4: shared venue cover and the weekend overview.
-- A venue-wide assignment (hub_assignments.scope = 'venue') is stored ONCE and shown as derived,
-- read-only context on every event it overlaps. Nothing is copied per event, so changing or
-- cancelling it updates every view at once. Overlap rules:
--   * event finish known   → covers "full" (whole window) or "partial"
--   * event finish unknown → only "at_start_only" (covers kick-off), never claimed for the whole event
-- Conflicts are flagged only for genuinely different places at the same time (same venue is fine).
-- ADDITIVE ONLY (plus a replaced hub_invite_to_help). Rollback: docs/sql/rollback-20261019000400.sql

-- ---------------------------------------------------------------------------
-- Where and when an active assignment needs someone. Unknown event finish → treated as the start
-- instant only (we never invent a finish).
-- ---------------------------------------------------------------------------
create function public._hub_assignment_window(p_a public.hub_assignments)
returns table (place text, place_name text, starts_at timestamptz, ends_at timestamptz, what text)
language sql stable security definer set search_path = '' as $$
  select
    case when p_a.scope = 'venue' then 'venue:' || p_a.venue_id
         when e.venue_id is not null then 'venue:' || e.venue_id else 'event:' || e.id end,
    coalesce(v.name, e.external_location_text, ve.name),
    coalesce(p_a.begins_at, e.starts_at),
    coalesce(p_a.ends_at, e.ends_at, coalesce(p_a.begins_at, e.starts_at) + interval '1 minute'),
    coalesce(p_a.responsibility_label, case when p_a.scope = 'venue' then 'Venue cover' else e.title end)
  from (select 1) one
  left join public.events e on e.id = p_a.event_id
  left join public.venues v on v.id = p_a.venue_id
  left join public.venues ve on ve.id = e.venue_id
$$;

-- Active commitments of a person that would need them somewhere ELSE at the same time.
create function public._hub_conflicts(p_person_id uuid, p_place text, p_starts timestamptz, p_ends timestamptz, p_exclude uuid default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', a.id, 'what', w.what, 'where', w.place_name,
                                               'starts_at', w.starts_at, 'ends_at', w.ends_at) order by w.starts_at), '[]'::jsonb)
  from public.hub_assignments a
  cross join lateral public._hub_assignment_window(a) w
  left join public.events e on e.id = a.event_id
  where a.person_id = p_person_id and a.state in ('pending', 'confirmed', 'needs_reconfirmation')
    and a.id is distinct from p_exclude
    and (e.id is null or e.status not in ('cancelled'))
    and w.place <> p_place
    and w.starts_at < p_ends and p_starts < w.ends_at
$$;

-- ---------------------------------------------------------------------------
-- Venue cover: create / change / respond (respond & cancel reuse the Stage 3 functions)
-- p_mode: 'request' | 'record_confirmed'. p_override_note: required to save despite a conflict.
-- ---------------------------------------------------------------------------
create function public.hub_create_venue_cover(p_venue_id uuid, p_person_id uuid, p_begins timestamptz, p_ends timestamptz,
                                              p_label text default null, p_mode text default 'request', p_override_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_label text := public._hub_clean(p_label, 80);
  v_conf jsonb;
  v_has_account boolean;
  v_id uuid;
  v_dup uuid;
begin
  if not public.hub_can_manage_venue(p_venue_id) then perform public._fail('not_authorised', 'You can only arrange cover at your venues.'); end if;
  if not exists (select 1 from public.venues where id = p_venue_id and active) then perform public._fail('venue_inactive', 'That venue is inactive.'); end if;
  if not exists (select 1 from public.people where id = p_person_id and lifecycle_status = 'active') then perform public._fail('not_found'); end if;
  if p_mode not in ('request', 'record_confirmed') then perform public._fail('invalid_mode'); end if;
  if p_begins is null or p_ends is null or p_begins >= p_ends then perform public._fail('invalid_times', 'The finish must be after the start.'); end if;
  if p_ends - p_begins > interval '24 hours' then perform public._fail('invalid_times', 'Cover can last at most 24 hours.'); end if;
  if p_ends <= now() then perform public._fail('invalid_times', 'That time has already passed.'); end if;

  -- Idempotent: the same person, venue, responsibility and times already live → return it.
  select id into v_dup from public.hub_assignments
   where scope = 'venue' and venue_id = p_venue_id and person_id = p_person_id and begins_at = p_begins and ends_at = p_ends
     and coalesce(lower(responsibility_label), '') = coalesce(lower(v_label), '')
     and state in ('pending', 'confirmed', 'needs_reconfirmation');
  if v_dup is not null then return jsonb_build_object('assignment_id', v_dup, 'status', 'already_exists'); end if;

  v_conf := public._hub_conflicts(p_person_id, 'venue:' || p_venue_id, p_begins, p_ends);
  if jsonb_array_length(v_conf) > 0 and public._hub_clean(p_override_note, 500) is null then
    perform public._fail('conflict', 'This person is already needed somewhere else at an overlapping time. Change the times, or save anyway with a note explaining why.');
  end if;

  select exists (select 1 from public.user_accounts ua where ua.person_id = p_person_id and ua.enabled and ua.auth_user_id is not null) into v_has_account;
  insert into public.hub_assignments (person_id, scope, venue_id, responsibility_label, begins_at, ends_at, state, invitation_source,
                                      response_source, recorded_by_person_id, requested_by_person_id, responded_at, conflict_override_note)
  values (p_person_id, 'venue', p_venue_id, v_label, p_begins, p_ends,
          case when p_mode = 'record_confirmed' then 'confirmed' else 'pending' end,
          case when p_mode = 'record_confirmed' or not v_has_account then 'offline' else 'portal' end,
          case when p_mode = 'record_confirmed' then 'admin_recorded' end,
          case when p_mode = 'record_confirmed' then v_me end, v_me,
          case when p_mode = 'record_confirmed' then now() end,
          case when jsonb_array_length(v_conf) > 0 then public._hub_clean(p_override_note, 500) end)
  returning id into v_id;
  if p_mode = 'request' and v_has_account then
    perform public._hub_notify('venue_cover_request', p_person_id, 'hub_assignments', v_id, '{}'::jsonb, 'venue_cover_request:' || v_id);
  end if;
  return jsonb_build_object('assignment_id', v_id, 'status', case when p_mode = 'record_confirmed' then 'recorded_confirmed' else 'pending' end,
                            'has_account', v_has_account, 'conflicts', v_conf);
end;
$$;

-- Change the times or responsibility of ONE venue cover (every derived event view follows).
-- If it was confirmed and the times change, it needs reconfirming unless the organiser records
-- that the person has agreed to the change (p_agreed).
create function public.hub_update_venue_cover(p_assignment_id uuid, p_begins timestamptz, p_ends timestamptz, p_label text,
                                              p_agreed boolean default false, p_override_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_a public.hub_assignments%rowtype;
  v_conf jsonb;
  v_times_changed boolean;
  v_state text;
begin
  select * into v_a from public.hub_assignments where id = p_assignment_id and scope = 'venue' for update;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_venue(v_a.venue_id) then perform public._fail('not_authorised'); end if;
  if v_a.state in ('cancelled', 'declined') then perform public._fail('invalid_transition', 'This cover is ' || v_a.state || '. Add a new one instead.'); end if;
  if p_begins is null or p_ends is null or p_begins >= p_ends then perform public._fail('invalid_times', 'The finish must be after the start.'); end if;
  if p_ends - p_begins > interval '24 hours' then perform public._fail('invalid_times', 'Cover can last at most 24 hours.'); end if;
  v_conf := public._hub_conflicts(v_a.person_id, 'venue:' || v_a.venue_id, p_begins, p_ends, v_a.id);
  if jsonb_array_length(v_conf) > 0 and public._hub_clean(coalesce(p_override_note, v_a.conflict_override_note), 500) is null then
    perform public._fail('conflict', 'This person is already needed somewhere else at an overlapping time. Change the times, or save anyway with a note.');
  end if;
  v_times_changed := p_begins <> v_a.begins_at or p_ends <> v_a.ends_at;
  v_state := case when v_a.state = 'confirmed' and v_times_changed and not coalesce(p_agreed, false) then 'needs_reconfirmation' else v_a.state end;
  update public.hub_assignments set begins_at = p_begins, ends_at = p_ends, responsibility_label = public._hub_clean(p_label, 80),
    state = v_state,
    response_source = case when v_a.state = 'confirmed' and v_times_changed and coalesce(p_agreed, false) then 'admin_recorded' else response_source end,
    recorded_by_person_id = case when v_a.state = 'confirmed' and v_times_changed and coalesce(p_agreed, false) then v_me else recorded_by_person_id end,
    conflict_override_note = case when jsonb_array_length(v_conf) > 0 then coalesce(public._hub_clean(p_override_note, 500), conflict_override_note) else null end
  where id = p_assignment_id;
  if v_state = 'needs_reconfirmation' and v_a.state <> 'needs_reconfirmation' then
    perform public._hub_notify('assignment_reconfirm', v_a.person_id, 'hub_assignments', v_a.id, '{}'::jsonb,
                               'assignment_reconfirm:' || v_a.id || ':' || extract(epoch from now())::bigint);
  end if;
  return jsonb_build_object('state', v_state, 'conflicts', v_conf);
end;
$$;

-- Preview while arranging cover: the club events it would overlap (derived, nothing is linked),
-- and anything that would clash for this person.
create function public.hub_venue_cover_preview(p_venue_id uuid, p_begins timestamptz, p_ends timestamptz, p_person_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._hub_require('manager');
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
                                                            'status', e.status, 'coverage', c.coverage) order by e.starts_at)
                        from public.events e cross join lateral (select public._hub_cover_kind(p_begins, p_ends, e.starts_at, e.ends_at) coverage) c
                        where e.venue_id = p_venue_id and e.status <> 'cancelled' and c.coverage is not null), '[]'::jsonb),
    'conflicts', case when p_person_id is null then '[]'::jsonb else public._hub_conflicts(p_person_id, 'venue:' || p_venue_id, p_begins, p_ends) end);
end;
$$;

-- How a cover window relates to an event window. NULL = no (claimable) overlap.
create function public._hub_cover_kind(p_cb timestamptz, p_ce timestamptz, p_es timestamptz, p_ee timestamptz) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_ee is null then case when p_cb <= p_es and p_ce > p_es then 'at_start_only' end
    when p_cb < p_ee and p_ce > p_es then case when p_cb <= p_es and p_ce >= p_ee then 'full' else 'partial' end
  end
$$;

-- Confirmed venue cover overlapping one event (derived; read-only context on the event page).
create function public.hub_venue_cover_for_event(p_event_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'person_id', a.person_id, 'name', coalesce(p.display_name, p.full_name),
                                               'label', a.responsibility_label, 'begins_at', a.begins_at, 'ends_at', a.ends_at, 'coverage', k.coverage)
                            order by a.begins_at), '[]'::jsonb)
  from public.events e
  join public.hub_assignments a on a.scope = 'venue' and a.venue_id = e.venue_id and a.state = 'confirmed'
  join public.people p on p.id = a.person_id
  cross join lateral (select public._hub_cover_kind(a.begins_at, a.ends_at, e.starts_at, e.ends_at) coverage) k
  where e.id = p_event_id and k.coverage is not null
$$;

-- Event involvement now includes derived venue cover (Stage 3 function, extended).
create or replace function public.hub_event_involvement(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.current_person_id();
  v_mgr boolean;
  v_event public.events%rowtype;
  v_day date;
begin
  if v_me is null then perform public._fail('not_authorised'); end if;
  select * into v_event from public.events where id = p_event_id;
  if not found or (v_event.status = 'draft' and not public.hub_can_manage_event(p_event_id)) then perform public._fail('not_found'); end if;
  v_mgr := public.hub_can_manage_event(p_event_id);
  v_day := (v_event.starts_at at time zone 'Europe/London')::date;
  return jsonb_build_object(
    'can_manage', v_mgr,
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'person_id', a.person_id, 'name', coalesce(p.display_name, p.full_name), 'label', a.responsibility_label,
        'begins_at', a.begins_at, 'ends_at', a.ends_at, 'state', a.state, 'response_source', a.response_source,
        'invitation_source', a.invitation_source, 'responded_at', a.responded_at, 'cancel_reason', case when v_mgr then a.cancel_reason end,
        'recorded_by', case when v_mgr then (select coalesce(r.display_name, r.full_name) from public.people r where r.id = a.recorded_by_person_id) end,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by a.state, a.begins_at nulls first)
      from public.hub_assignments a join public.people p on p.id = a.person_id
      where a.scope = 'event' and a.event_id = p_event_id
        and (v_mgr or a.state in ('confirmed', 'needs_reconfirmation') or a.person_id = v_me)), '[]'::jsonb),
    'venue_cover', case when v_event.status = 'cancelled' then '[]'::jsonb else public.hub_venue_cover_for_event(p_event_id) end,
    'expected', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', tp.person_id, 'name', coalesce(p.display_name, p.full_name), 'role', tp.role_label,
        'override', x.override, 'override_note', case when v_mgr then x.note end,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by tp.role_label, p.full_name)
      from public.team_people tp join public.people p on p.id = tp.person_id
      left join public.event_participation_exceptions x on x.event_id = p_event_id and x.person_id = tp.person_id
      where v_event.team_id is not null and tp.team_id = v_event.team_id and tp.is_expected_by_default
        and p.lifecycle_status = 'active' and tp.active_from <= v_day and (tp.active_to is null or tp.active_to >= v_day)
        and (v_mgr or x.override is distinct from 'not_expected')), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', ea.person_id, 'name', coalesce(p.display_name, p.full_name), 'response', ea.response,
        'for_full_event', ea.for_full_event, 'available_from', ea.available_from, 'available_until', ea.available_until,
        'needs_admin_check', case when v_mgr then ea.needs_admin_check end, 'response_source', ea.response_source,
        'recorded_by', case when v_mgr then (select coalesce(r.display_name, r.full_name) from public.people r where r.id = ea.recorded_by_person_id) end,
        'responded_at', ea.responded_at,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by ea.responded_at)
      from public.event_availability ea join public.people p on p.id = ea.person_id
      where ea.event_id = p_event_id and (v_mgr or ea.response = 'yes' or ea.person_id = v_me)), '[]'::jsonb),
    'requests', case when v_mgr then coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', r.person_id, 'name', coalesce(p.display_name, p.full_name), 'requested_at', r.requested_at,
        'delivery_state', r.delivery_state, 'replied', exists (select 1 from public.event_availability ea where ea.event_id = r.event_id and ea.person_id = r.person_id),
        'email', p.email_normalized::text, 'phone', p.phone_normalized) order by p.full_name)
      from public.availability_requests r join public.people p on p.id = r.person_id
      where r.event_id = p_event_id), '[]'::jsonb) else '[]'::jsonb end,
    'my_request', exists (select 1 from public.availability_requests r where r.event_id = p_event_id and r.person_id = v_me));
end;
$$;

-- Venue cover in a date range: confirmed cover for everyone (name, responsibility, times — no contact
-- details); organisers in scope also see pending/needs-reconfirmation cover and contact details.
-- Each row carries how many club events it overlaps ("Also supports N events").
create function public.hub_venue_covers(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('member');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'person_id', a.person_id, 'name', coalesce(p.display_name, p.full_name), 'venue_id', a.venue_id, 'label', a.responsibility_label,
      'begins_at', a.begins_at, 'ends_at', a.ends_at, 'state', a.state, 'response_source', a.response_source,
      'can_manage', public.hub_can_manage_venue(a.venue_id), 'conflict_override_note', case when public.hub_can_manage_venue(a.venue_id) then a.conflict_override_note end,
      'phone', case when public.hub_can_manage_venue(a.venue_id) then p.phone_normalized end,
      'events', (select count(*) from public.events e where e.venue_id = a.venue_id and e.status not in ('cancelled', 'draft')
                   and public._hub_cover_kind(a.begins_at, a.ends_at, e.starts_at, e.ends_at) is not null))
      order by a.begins_at)
    from public.hub_assignments a join public.people p on p.id = a.person_id
    where a.scope = 'venue' and a.begins_at < p_to and a.ends_at > p_from
      and (a.state = 'confirmed' or a.person_id = v_me
           or (public.hub_can_manage_venue(a.venue_id) and a.state in ('pending', 'needs_reconfirmation', 'declined')))), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Organiser overview for a date range (spec 01 §12): per event, UNIQUE people by status;
-- per day, unique people across all events and venue cover (Kelly counts once).
-- ---------------------------------------------------------------------------
create function public.hub_manage_overview(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._hub_require('manager');
  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'kickoff_at', e.kickoff_at,
        'venue_id', e.venue_id, 'external_location_text', e.external_location_text, 'team_id', e.team_id, 'status', e.status,
        'volunteers_enabled', e.volunteers_enabled, 'category', e.category, 'is_demo', e.is_demo,
        'counts', public._hub_event_counts(e.id)) order by e.starts_at)
      from public.events e
      where e.starts_at >= p_from and e.starts_at < p_to and e.status <> 'draft' and public.hub_can_manage_event(e.id)), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'people', d.people) order by d.day)
      from (select x.day, count(distinct x.person_id) people from (
              select (coalesce(a.begins_at, e.starts_at) at time zone 'Europe/London')::date as day, a.person_id
                from public.hub_assignments a left join public.events e on e.id = a.event_id
               where a.state = 'confirmed' and coalesce(a.begins_at, e.starts_at) >= p_from and coalesce(a.begins_at, e.starts_at) < p_to
                 and (e.id is null or e.status <> 'cancelled')
                 and (a.scope = 'venue' and public.hub_can_manage_venue(a.venue_id) or a.scope = 'event' and public.hub_can_manage_event(a.event_id))
            ) x group by x.day) d), '[]'::jsonb),
    'drafts', (select count(*) from public.events e where e.status = 'draft' and e.starts_at >= now() and public.hub_can_manage_event(e.id)),
    'needs_check', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'name', coalesce(p.display_name, p.full_name)))
      from public.event_availability ea join public.events e on e.id = ea.event_id join public.people p on p.id = ea.person_id
      where ea.needs_admin_check and e.starts_at >= now() and e.status = 'published' and public.hub_can_manage_event(e.id)), '[]'::jsonb));
end;
$$;

-- Unique people per status for one event, each person counted once in their strongest status:
-- confirmed (incl. venue cover) > expected > available > pending.
create function public._hub_event_counts(p_event_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with e as (select * from public.events where id = p_event_id),
  confirmed as (
    select a.person_id from public.hub_assignments a where a.scope = 'event' and a.event_id = p_event_id and a.state = 'confirmed'
    union select (c ->> 'person_id')::uuid from jsonb_array_elements(public.hub_venue_cover_for_event(p_event_id)) c
    union select x.person_id from public.event_participation_exceptions x where x.event_id = p_event_id and x.override = 'confirmed_by_admin'),
  expected as (
    select tp.person_id from e join public.team_people tp on tp.team_id = e.team_id and tp.is_expected_by_default
    join public.people p on p.id = tp.person_id and p.lifecycle_status = 'active'
    where tp.active_from <= (e.starts_at at time zone 'Europe/London')::date
      and (tp.active_to is null or tp.active_to >= (e.starts_at at time zone 'Europe/London')::date)
      and not exists (select 1 from public.event_participation_exceptions x where x.event_id = p_event_id and x.person_id = tp.person_id)
    except select person_id from confirmed),
  available as (
    select ea.person_id from public.event_availability ea where ea.event_id = p_event_id and ea.response = 'yes'
    except select person_id from confirmed except select person_id from expected),
  pending as (
    select a.person_id from public.hub_assignments a where a.scope = 'event' and a.event_id = p_event_id and a.state in ('pending', 'needs_reconfirmation')
    except select person_id from confirmed),
  unanswered as (
    select r.person_id from public.availability_requests r where r.event_id = p_event_id
      and not exists (select 1 from public.event_availability ea where ea.event_id = r.event_id and ea.person_id = r.person_id))
  select jsonb_build_object('confirmed', (select count(*) from confirmed), 'expected', (select count(*) from expected),
                            'available', (select count(*) from available), 'pending', (select count(*) from pending),
                            'unanswered', (select count(*) from unanswered))
$$;

-- ---------------------------------------------------------------------------
-- Direct invitations now also warn about clashes at another place (replaces the Stage 3 version).
-- ---------------------------------------------------------------------------
drop function public.hub_invite_to_help(uuid, uuid, text, timestamptz, timestamptz, text);
create function public.hub_invite_to_help(p_event_id uuid, p_person_id uuid, p_label text default null,
                                          p_begins timestamptz default null, p_ends timestamptz default null,
                                          p_mode text default 'request', p_override_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_event public.events%rowtype;
  v_label text := public._hub_clean(p_label, 80);
  v_has_account boolean;
  v_existing public.hub_assignments%rowtype;
  v_id uuid;
  v_delivery text := 'not_sent';
  v_conf jsonb;
  v_place text;
  v_s timestamptz;
  v_e timestamptz;
begin
  if p_mode not in ('request', 'record_confirmed') then perform public._fail('invalid_mode'); end if;
  select * into v_event from public.events where id = p_event_id for share;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if v_event.status in ('cancelled', 'completed') then perform public._fail('event_not_open', 'This event is ' || v_event.status || '.'); end if;
  if not exists (select 1 from public.people where id = p_person_id and lifecycle_status = 'active') then perform public._fail('not_found'); end if;
  if p_begins is not null and p_ends is not null and p_begins >= p_ends then perform public._fail('invalid_times', 'The finish must be after the start.'); end if;
  if p_mode = 'request' and v_event.status = 'draft' then
    perform public._fail('event_not_open', 'Publish the event before asking people, so they can see it.');
  end if;

  select * into v_existing from public.hub_assignments
   where scope = 'event' and event_id = p_event_id and person_id = p_person_id
     and coalesce(lower(responsibility_label), '') = coalesce(lower(v_label), '')
     and state in ('pending', 'confirmed', 'needs_reconfirmation')
   for update;
  if found then
    if p_mode = 'record_confirmed' and v_existing.state <> 'confirmed' then
      update public.hub_assignments set state = 'confirmed', response_source = 'admin_recorded', recorded_by_person_id = v_me, responded_at = now()
       where id = v_existing.id;
      return jsonb_build_object('assignment_id', v_existing.id, 'status', 'recorded_confirmed', 'existing', true);
    end if;
    return jsonb_build_object('assignment_id', v_existing.id, 'status', 'already_' || v_existing.state, 'existing', true);
  end if;

  v_place := case when v_event.venue_id is not null then 'venue:' || v_event.venue_id else 'event:' || v_event.id end;
  v_s := coalesce(p_begins, v_event.starts_at);
  v_e := coalesce(p_ends, v_event.ends_at, v_s + interval '1 minute');
  v_conf := public._hub_conflicts(p_person_id, v_place, v_s, v_e);
  if jsonb_array_length(v_conf) > 0 and public._hub_clean(p_override_note, 500) is null then
    perform public._fail('conflict', 'This person is already needed somewhere else at an overlapping time. Change the times, or save anyway with a note explaining why.');
  end if;

  select exists (select 1 from public.user_accounts ua where ua.person_id = p_person_id and ua.enabled and ua.auth_user_id is not null)
    into v_has_account;
  insert into public.hub_assignments (person_id, scope, event_id, responsibility_label, begins_at, ends_at, state,
                                      invitation_source, response_source, recorded_by_person_id, requested_by_person_id, responded_at,
                                      conflict_override_note)
  values (p_person_id, 'event', p_event_id, v_label, p_begins, p_ends,
          case when p_mode = 'record_confirmed' then 'confirmed' else 'pending' end,
          case when p_mode = 'record_confirmed' or not v_has_account then 'offline' else 'portal' end,
          case when p_mode = 'record_confirmed' then 'admin_recorded' end,
          case when p_mode = 'record_confirmed' then v_me end, v_me,
          case when p_mode = 'record_confirmed' then now() end,
          case when jsonb_array_length(v_conf) > 0 then public._hub_clean(p_override_note, 500) end)
  returning id into v_id;
  if p_mode = 'request' and v_has_account then
    v_delivery := public._hub_notify('assignment_request', p_person_id, 'hub_assignments', v_id,
                                     jsonb_build_object('event_id', p_event_id), 'assignment_request:' || v_id);
  end if;
  return jsonb_build_object('assignment_id', v_id, 'status', case when p_mode = 'record_confirmed' then 'recorded_confirmed' else 'pending' end,
                            'has_account', v_has_account, 'delivery', v_delivery, 'existing', false, 'conflicts', v_conf);
end;
$$;

grant execute on function
  public.hub_create_venue_cover(uuid, uuid, timestamptz, timestamptz, text, text, text),
  public.hub_update_venue_cover(uuid, timestamptz, timestamptz, text, boolean, text),
  public.hub_venue_cover_preview(uuid, timestamptz, timestamptz, uuid),
  public.hub_venue_covers(timestamptz, timestamptz),
  public.hub_manage_overview(timestamptz, timestamptz),
  public.hub_invite_to_help(uuid, uuid, text, timestamptz, timestamptz, text, text)
to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261019000400', 'hub_venue_cover') on conflict (version) do nothing;

-- ====================================================================== 20261019000500_hub_positions
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261019000500', 'hub_positions') on conflict (version) do nothing;

-- ====================================================================== 20261019000600_hub_applications
-- Volunteer Hub · Stage 6: public (no-login) volunteer applications and the review inbox.
--  * Submitted ONLY through the server endpoint with the secret key → public_submit_application().
--    anon has no access at all; the function returns nothing about anyone (generic acknowledgement).
--  * An application never creates a login, a portal invitation, a person record or a role appointment.
--  * Possible duplicates (same email/phone as a person or another application) are FLAGGED for an
--    admin; nothing is merged or overwritten automatically.
--  * Role suggestions are deterministic and explained; they never accept, reject or appoint anyone.
--  * Personal answers are kept out of the audit log (only stage changes and who did them).
-- ADDITIVE ONLY. Rollback: docs/sql/rollback-20261019000600.sql

alter table public.club_settings
  add column contact_email text check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column applications_open boolean not null default true,
  add column application_retention_months integer check (application_retention_months is null or application_retention_months between 1 and 120);

create table public.volunteer_applications (
  id                        uuid primary key default gen_random_uuid(),
  linked_person_id          uuid references public.people (id) on delete set null,
  full_name                 text not null check (char_length(btrim(full_name)) between 1 and 120),
  email_normalized          extensions.citext check (email_normalized is null or email_normalized ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone_normalized          text check (phone_normalized is null or phone_normalized ~ '^\+?[0-9]{6,15}$'),
  contact_preference        text not null check (contact_preference in ('email', 'phone', 'whatsapp', 'no_preference')),
  existing_club_connection  text check (existing_club_connection in ('player', 'parent_carer', 'supporter', 'former_member', 'community', 'other', 'not_currently')),
  heard_from                text check (heard_from in ('friend_family', 'social_media', 'club_event', 'website', 'other')),
  interests                 text[] not null default '{}' check (cardinality(interests) <= 40),
  selected_position_ids     uuid[] not null default '{}' check (cardinality(selected_position_ids) <= 20),
  unsure_role               boolean not null default false,
  strengths                 text[] not null default '{}' check (cardinality(strengths) <= 20),
  experience_text           text check (experience_text is null or char_length(experience_text) <= 1000),
  willing_to_learn          text check (willing_to_learn in ('yes', 'maybe', 'no')),
  availability              jsonb not null default '[]'::jsonb,
  availability_varies       boolean not null default false,
  commitment_bucket         text check (commitment_bucket in ('lt2', '2to4', '5to10', '10plus', 'varies')),
  commitment_pattern        text check (commitment_pattern in ('regular', 'occasional', 'one_off', 'unsure')),
  work_location_preference  text check (work_location_preference in ('onsite', 'remote', 'either')),
  free_notes                text check (free_notes is null or char_length(free_notes) <= 1000),
  privacy_notice_version    text not null check (char_length(privacy_notice_version) between 1 and 40),
  privacy_acknowledged_at   timestamptz not null,
  communication_opt_in      boolean not null default false,
  communication_opt_in_at   timestamptz,
  stage                     text not null default 'new' check (stage in ('new', 'reviewing', 'contacted', 'trial', 'accepted_to_pool', 'closed')),
  duplicate_review_status   text not null default 'none' check (duplicate_review_status in ('none', 'possible_duplicate', 'linked', 'not_duplicate')),
  duplicate_candidates      jsonb not null default '[]'::jsonb,
  assigned_reviewer_id      uuid references public.people (id) on delete set null,
  last_contacted_at         timestamptz,
  follow_up_on              date,
  admin_notes               text check (admin_notes is null or char_length(admin_notes) <= 2000),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  retention_review_at       date,
  constraint volunteer_applications_contact check (email_normalized is not null or phone_normalized is not null),
  constraint volunteer_applications_pref_has_channel check (
    contact_preference = 'no_preference'
    or (contact_preference = 'email' and email_normalized is not null)
    or (contact_preference in ('phone', 'whatsapp') and phone_normalized is not null))
);
create index volunteer_applications_stage_idx on public.volunteer_applications (stage, created_at);
create index volunteer_applications_email_idx on public.volunteer_applications (email_normalized) where email_normalized is not null;
create index volunteer_applications_phone_idx on public.volunteer_applications (phone_normalized) where phone_normalized is not null;

create table public.application_role_suggestions (
  application_id    uuid not null references public.volunteer_applications (id) on delete cascade,
  club_position_id  uuid not null references public.club_positions (id) on delete cascade,
  score             integer not null,
  reasons           jsonb not null default '[]'::jsonb,
  needs_checks      boolean not null default false,
  computed_at       timestamptz not null default now(),
  primary key (application_id, club_position_id)
);

-- Rate limiting for the public endpoint (hashed keys only; no raw IPs or contact details).
create table public.hub_rate_events (
  id          bigint generated always as identity primary key,
  bucket      text not null check (char_length(bucket) <= 80),
  created_at  timestamptz not null default now()
);
create index hub_rate_events_bucket_idx on public.hub_rate_events (bucket, created_at);

alter table public.position_interests
  add constraint position_interests_application_fk foreign key (application_id) references public.volunteer_applications (id) on delete cascade;
create unique index position_interests_application_uq on public.position_interests (position_id, application_id) where application_id is not null;

create trigger volunteer_applications_set_updated_at before update on public.volunteer_applications
  for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['volunteer_applications', 'application_role_suggestions', 'hub_rate_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;
-- Admins only, and read-only from the client: every change goes through the functions below.
grant select on public.volunteer_applications, public.application_role_suggestions to authenticated;
create policy volunteer_applications_admin_read on public.volunteer_applications for select to authenticated using ((select public.hub_is_admin()));
create policy application_role_suggestions_admin_read on public.application_role_suggestions for select to authenticated using ((select public.hub_is_admin()));
-- hub_rate_events: no grants at all.

-- ---------------------------------------------------------------------------
-- Rule-based, explainable role suggestions
-- ---------------------------------------------------------------------------
create function public._hub_suggest_roles(p_application_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.volunteer_applications%rowtype;
begin
  select * into a from public.volunteer_applications where id = p_application_id;
  if not found then return; end if;
  delete from public.application_role_suggestions where application_id = p_application_id;
  insert into public.application_role_suggestions (application_id, club_position_id, score, reasons, needs_checks)
  select p_application_id, s.id, s.score, s.reasons, s.needs_checks
  from (
    select p.id, p.requires_external_safeguarding_review as needs_checks,
      (case when p.id = any (a.selected_position_ids) then 50 else 0 end
       + 10 * cardinality(array(select unnest(p.interest_tags) intersect select unnest(a.interests)))
       + 5 * (select count(*) from unnest(a.strengths) st where exists (
              select 1 from unnest(p.skills_desirable || p.skills_required) sk where lower(sk) like '%' || st || '%' or st like '%' || lower(sk) || '%'))
       + case when a.unsure_role and (p.seeking_replacement or p.seeking_additional_help) then 5 else 0 end
       + case when (p.seeking_replacement and a.willing_to_learn in ('yes', 'maybe')) then 5 else 0 end
       + case when p.work_location_preference is not null and a.work_location_preference is not null
                   and p.work_location_preference <> 'either' and a.work_location_preference <> 'either'
                   and p.work_location_preference <> a.work_location_preference then -10 else 0 end)::int as score,
      to_jsonb(array_remove(array[
        case when p.id = any (a.selected_position_ids) then 'Chose this role on the form' end,
        case when cardinality(array(select unnest(p.interest_tags) intersect select unnest(a.interests))) > 0
             then 'Interests match: ' || array_to_string(array(select unnest(p.interest_tags) intersect select unnest(a.interests)), ', ') end,
        case when exists (select 1 from unnest(a.strengths) st where exists (
               select 1 from unnest(p.skills_desirable || p.skills_required) sk where lower(sk) like '%' || st || '%' or st like '%' || lower(sk) || '%'))
             then 'Strengths match the skills this role needs' end,
        case when a.unsure_role and (p.seeking_replacement or p.seeking_additional_help) then 'Not sure yet, and this role is looking for help' end,
        case when p.seeking_replacement and a.willing_to_learn in ('yes', 'maybe') then 'Happy to learn or shadow — useful for a handover' end,
        case when p.work_location_preference is not null and a.work_location_preference is not null
                  and p.work_location_preference <> 'either' and a.work_location_preference <> 'either'
                  and p.work_location_preference <> a.work_location_preference then 'Where they want to help doesn''t match this role' end,
        case when p.requires_external_safeguarding_review then 'Needs club/FA checks: a human decision, never automatic' end], null)) as reasons
    from public.club_positions p where p.active
  ) s
  where s.score > 0
  order by s.score desc
  limit 5;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public submission (secret key only). Returns only {received: true}. Raises a stable error code on
-- invalid input or rate limiting, never anything about existing people or applications.
-- p_rate_key: hashed client identifier from the server (never a raw IP).
-- ---------------------------------------------------------------------------
create function public.public_submit_application(p jsonb, p_rate_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := public._hub_clean(p ->> 'full_name', 200);
  v_email text := lower(public._hub_clean(p ->> 'email', 254));
  v_phone text := public._hub_normalize_phone(p ->> 'phone');
  v_pref text := coalesce(nullif(p ->> 'contact_preference', ''), 'no_preference');
  v_id uuid;
  v_dups jsonb;
  v_interests text[];
  v_strengths text[];
  v_positions uuid[];
  v_allowed_interests text[] := array['gate_admissions','refreshments','pitch_setup','event_support','pitch_marking','maintenance','open_close','cleaning',
    'coaching','youth_activities','vets_ladies_support','secretary','finance','welfare','governance','social_media','website','photography','fundraising',
    'community_events','site_lead','open_unlock','lock_secure','facility_checks','general_support'];
  v_allowed_strengths text[] := array['organisation','communication','administration','finance','it','creative','practical','groundskeeping','coaching','people','events','fundraising','other'];
  v_slots jsonb;
begin
  if not coalesce((select applications_open from public.club_settings where id = 1), true) then
    perform public._fail('applications_closed', 'The club isn''t taking online offers of help at the moment.');
  end if;
  -- Rate limits: per client key 5/hour; per contact 3/day.
  if p_rate_key is null or char_length(p_rate_key) < 16 then perform public._fail('invalid_request'); end if;
  if (select count(*) from public.hub_rate_events where bucket = 'apply:' || left(p_rate_key, 64) and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.volunteer_applications where created_at > now() - interval '1 day'
           and ((v_email is not null and email_normalized = v_email::extensions.citext) or (v_phone is not null and phone_normalized = v_phone))) >= 3 then
    perform public._fail('rate_limited', 'Too many submissions. Please try again later.');
  end if;
  insert into public.hub_rate_events (bucket) values ('apply:' || left(p_rate_key, 64));
  delete from public.hub_rate_events where created_at < now() - interval '2 days';

  -- Validation (the endpoint validates too).
  if coalesce((p ->> 'is_adult')::boolean, false) is not true then
    perform public._fail('under_18', 'This form is for adults. Young volunteers can contact the club with a parent or carer.');
  end if;
  if v_name is null or char_length(v_name) > 120 then perform public._fail('invalid_name', 'Enter your name.'); end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public._fail('invalid_email', 'Enter a valid email address.'); end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{6,15}$' then perform public._fail('invalid_phone', 'Enter a valid phone number.'); end if;
  if v_email is null and v_phone is null then perform public._fail('contact_required', 'Give an email address or a phone number.'); end if;
  if v_pref not in ('email', 'phone', 'whatsapp', 'no_preference')
     or (v_pref = 'email' and v_email is null) or (v_pref in ('phone', 'whatsapp') and v_phone is null) then
    perform public._fail('invalid_preference', 'Choose a way to contact you that you''ve given us.');
  end if;
  if coalesce((p ->> 'privacy_acknowledged')::boolean, false) is not true or public._hub_clean(p ->> 'privacy_notice_version', 40) is null then
    perform public._fail('privacy_required', 'Please confirm you''ve read the privacy notice.');
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_interests from jsonb_array_elements_text(coalesce(p -> 'interests', '[]')) x where x = any (v_allowed_interests);
  select coalesce(array_agg(distinct x), '{}') into v_strengths from jsonb_array_elements_text(coalesce(p -> 'strengths', '[]')) x where x = any (v_allowed_strengths);
  -- Only roles that are publicly advertised can be chosen.
  select coalesce(array_agg(distinct cp.id), '{}') into v_positions
    from jsonb_array_elements_text(coalesce(p -> 'selected_position_ids', '[]')) x
    join public.club_positions cp on cp.id::text = x and public._hub_public_reason(cp) is not null;
  select coalesce(jsonb_agg(distinct jsonb_build_object('day', (s ->> 'day')::int, 'daypart', s ->> 'daypart')), '[]'::jsonb) into v_slots
    from jsonb_array_elements(coalesce(p -> 'availability', '[]')) s
    where (s ->> 'day') ~ '^[0-6]$' and s ->> 'daypart' in ('morning', 'afternoon', 'evening');

  insert into public.volunteer_applications (full_name, email_normalized, phone_normalized, contact_preference, existing_club_connection, heard_from,
    interests, selected_position_ids, unsure_role, strengths, experience_text, willing_to_learn, availability, availability_varies,
    commitment_bucket, commitment_pattern, work_location_preference, free_notes, privacy_notice_version, privacy_acknowledged_at,
    communication_opt_in, communication_opt_in_at, retention_review_at)
  values (v_name, v_email, v_phone, v_pref,
    case when p ->> 'existing_club_connection' in ('player', 'parent_carer', 'supporter', 'former_member', 'community', 'other', 'not_currently') then p ->> 'existing_club_connection' end,
    case when p ->> 'heard_from' in ('friend_family', 'social_media', 'club_event', 'website', 'other') then p ->> 'heard_from' end,
    v_interests, v_positions, coalesce((p ->> 'unsure_role')::boolean, false), v_strengths,
    public._hub_clean(p ->> 'experience_text', 1000),
    case when p ->> 'willing_to_learn' in ('yes', 'maybe', 'no') then p ->> 'willing_to_learn' end,
    v_slots, coalesce((p ->> 'availability_varies')::boolean, false),
    case when p ->> 'commitment_bucket' in ('lt2', '2to4', '5to10', '10plus', 'varies') then p ->> 'commitment_bucket' end,
    case when p ->> 'commitment_pattern' in ('regular', 'occasional', 'one_off', 'unsure') then p ->> 'commitment_pattern' end,
    case when p ->> 'work_location_preference' in ('onsite', 'remote', 'either') then p ->> 'work_location_preference' end,
    public._hub_clean(p ->> 'free_notes', 1000), public._hub_clean(p ->> 'privacy_notice_version', 40), now(),
    coalesce((p ->> 'communication_opt_in')::boolean, false),
    case when coalesce((p ->> 'communication_opt_in')::boolean, false) then now() end,
    case when (select application_retention_months from public.club_settings where id = 1) is not null
         then ((now() at time zone 'Europe/London')::date + make_interval(months => (select application_retention_months from public.club_settings where id = 1)))::date end)
  returning id into v_id;

  -- Possible duplicates: flagged for review, never merged.
  select coalesce(jsonb_agg(d), '[]'::jsonb) into v_dups from (
    select jsonb_build_object('kind', 'person', 'id', pp.id, 'match', case when pp.email_normalized = v_email::extensions.citext then 'email' else 'phone' end) d
      from public.people pp
     where (v_email is not null and pp.email_normalized = v_email::extensions.citext) or (v_phone is not null and pp.phone_normalized = v_phone)
    union all
    select jsonb_build_object('kind', 'application', 'id', va.id, 'match', case when va.email_normalized = v_email::extensions.citext then 'email' else 'phone' end)
      from public.volunteer_applications va
     where va.id <> v_id and ((v_email is not null and va.email_normalized = v_email::extensions.citext) or (v_phone is not null and va.phone_normalized = v_phone))) x;
  if jsonb_array_length(v_dups) > 0 then
    update public.volunteer_applications set duplicate_review_status = 'possible_duplicate', duplicate_candidates = v_dups where id = v_id;
  end if;

  insert into public.position_interests (position_id, application_id, stage)
  select x, v_id, 'interested' from unnest(v_positions) x;
  perform public._hub_suggest_roles(v_id);
  insert into public.audit_log (action, entity_type, entity_id, new_data, source)
  values ('application_received', 'volunteer_applications', v_id, jsonb_build_object('stage', 'new'), 'public_form');
  return jsonb_build_object('received', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin review (applications are admin-only)
-- ---------------------------------------------------------------------------
create function public._hub_app_audit(p_id uuid, p_action text, p_detail jsonb default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_person_id, action, entity_type, entity_id, new_data, source)
  values (public.current_person_id(), p_action, 'volunteer_applications', p_id, p_detail, 'portal')
$$;

create function public.hub_update_application(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.volunteer_applications%rowtype; v_stage text;
begin
  perform public._hub_require('admin');
  select * into v_old from public.volunteer_applications where id = p_id for update;
  if not found then perform public._fail('not_found'); end if;
  v_stage := coalesce(nullif(p ->> 'stage', ''), v_old.stage);
  if v_stage not in ('new', 'reviewing', 'contacted', 'trial', 'accepted_to_pool', 'closed') then perform public._fail('invalid_stage'); end if;
  update public.volunteer_applications set
    stage = v_stage,
    follow_up_on = case when p ? 'follow_up_on' then nullif(p ->> 'follow_up_on', '')::date else follow_up_on end,
    admin_notes = case when p ? 'admin_notes' then public._hub_clean(p ->> 'admin_notes', 2000) else admin_notes end,
    assigned_reviewer_id = case when p ? 'assigned_reviewer_id' then nullif(p ->> 'assigned_reviewer_id', '')::uuid else assigned_reviewer_id end,
    last_contacted_at = case when coalesce((p ->> 'contacted_now')::boolean, false) then now() else last_contacted_at end,
    duplicate_review_status = case when p ->> 'duplicate_review_status' in ('not_duplicate', 'possible_duplicate') then p ->> 'duplicate_review_status' else duplicate_review_status end
  where id = p_id;
  if v_stage <> v_old.stage or coalesce((p ->> 'contacted_now')::boolean, false) then
    perform public._hub_app_audit(p_id, 'application_updated', jsonb_build_object('stage', v_stage, 'contacted', coalesce((p ->> 'contacted_now')::boolean, false)));
  end if;
end;
$$;

-- Link to an EXISTING person after review. Never overwrites the person's details.
create function public.hub_link_application(p_id uuid, p_person_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._hub_require('admin');
  if not exists (select 1 from public.people where id = p_person_id) then perform public._fail('not_found'); end if;
  update public.volunteer_applications set linked_person_id = p_person_id, duplicate_review_status = 'linked' where id = p_id;
  if not found then perform public._fail('not_found'); end if;
  update public.position_interests set person_id = p_person_id
   where application_id = p_id and not exists (select 1 from public.position_interests pi2 where pi2.position_id = position_interests.position_id and pi2.person_id = p_person_id);
  perform public._hub_app_audit(p_id, 'application_linked', jsonb_build_object('person_id', p_person_id));
end;
$$;

-- Create a directory person from the application (explicit). No login, no invitation, no role.
create function public.hub_create_person_from_application(p_id uuid, p_routine boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('admin');
  a public.volunteer_applications%rowtype;
  v_pid uuid;
begin
  select * into a from public.volunteer_applications where id = p_id for update;
  if not found then perform public._fail('not_found'); end if;
  if a.linked_person_id is not null then perform public._fail('already_linked', 'This application is already linked to someone in the directory.'); end if;
  if a.email_normalized is not null and exists (select 1 from public.people where email_normalized = a.email_normalized) then
    perform public._fail('duplicate_email', 'Someone in the directory already has this email address. Link the application to them instead.');
  end if;
  insert into public.people (full_name, email_normalized, phone_normalized, preferred_contact_channel, involvement, routine_requests_enabled, created_by_person_id)
  values (a.full_name, a.email_normalized, a.phone_normalized, case when a.contact_preference = 'no_preference' then null else a.contact_preference end,
          array['volunteer'], coalesce(p_routine, false), v_me)
  returning id into v_pid;
  insert into public.volunteer_preferences (person_id, commitment_bucket, commitment_pattern, location_preference, willing_to_learn, strengths, interests, free_text)
  values (v_pid, a.commitment_bucket, a.commitment_pattern, a.work_location_preference, a.willing_to_learn, a.strengths, a.interests, a.experience_text);
  insert into public.usual_availability (person_id, day_of_week, daypart)
  select distinct v_pid, (s ->> 'day')::smallint, s ->> 'daypart' from jsonb_array_elements(a.availability) s;
  update public.volunteer_applications set linked_person_id = v_pid, duplicate_review_status = case when duplicate_review_status = 'possible_duplicate' then 'not_duplicate' else duplicate_review_status end
   where id = p_id;
  update public.position_interests set person_id = v_pid where application_id = p_id;
  perform public._hub_app_audit(p_id, 'application_person_created', jsonb_build_object('person_id', v_pid));
  return v_pid;
end;
$$;

-- Note the applicant as interested in a role (a suggestion an organiser accepts). Not an appointment.
create function public.hub_match_application_position(p_id uuid, p_position_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.volunteer_applications%rowtype;
begin
  perform public._hub_require('admin');
  select * into a from public.volunteer_applications where id = p_id;
  if not found then perform public._fail('not_found'); end if;
  if not exists (select 1 from public.club_positions where id = p_position_id and active) then perform public._fail('not_found'); end if;
  insert into public.position_interests (position_id, application_id, person_id, stage)
  values (p_position_id, p_id, a.linked_person_id, 'interested')
  on conflict do nothing;
end;
$$;

create function public.hub_recompute_suggestions(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._hub_require('admin');
  perform public._hub_suggest_roles(p_id);
end;
$$;

-- Delete an application per the club's policy (personal data removed; an audit line without contents stays).
create function public.hub_delete_application(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._hub_require('admin');
  delete from public.volunteer_applications where id = p_id;
  if not found then perform public._fail('not_found'); end if;
  perform public._hub_app_audit(p_id, 'application_deleted', null);
end;
$$;

-- Inbox counts for the overview.
create function public.hub_application_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.hub_is_admin() then jsonb_build_object(
    'new', (select count(*) from public.volunteer_applications where stage = 'new'),
    'follow_up_due', (select count(*) from public.volunteer_applications where stage not in ('closed', 'accepted_to_pool') and follow_up_on <= (now() at time zone 'Europe/London')::date),
    'retention_due', (select count(*) from public.volunteer_applications where retention_review_at <= (now() at time zone 'Europe/London')::date))
  else jsonb_build_object('new', 0, 'follow_up_due', 0, 'retention_due', 0) end
$$;

grant execute on function public.hub_update_application(uuid, jsonb), public.hub_link_application(uuid, uuid),
  public.hub_create_person_from_application(uuid, boolean), public.hub_match_application_position(uuid, uuid),
  public.hub_recompute_suggestions(uuid), public.hub_delete_application(uuid), public.hub_application_counts()
to authenticated;
revoke execute on function public.public_submit_application(jsonb, text) from public, anon, authenticated;
grant execute on function public.public_submit_application(jsonb, text) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261019000600', 'hub_applications') on conflict (version) do nothing;

-- ====================================================================== 20261019000700_hub_notifications
-- Volunteer Hub · Stage 7: email for Hub actions through the EXISTING outbox, plus settings and privacy tools.
-- Messages are queued only by deliberate organiser/volunteer actions (requests, invitations, answers,
-- reconfirmations, cancellations) and day-before reminders. Never by creating a person, an event or an
-- application. Every existing safety gate still applies: EMAIL_SENDING_ENABLED, the admin release switch
-- (email held until an administrator starts it), the non-production allow-list, idempotency keys,
-- retries with back-off, and a re-check of every message just before it is sent.
-- ADDITIVE (+ replaced worker functions). Rollback: docs/sql/rollback-20261019000700.sql

alter table public.notification_outbox
  alter column recipient_volunteer_id drop not null,
  add column recipient_person_id uuid references public.people (id) on delete cascade,
  add constraint notification_outbox_has_recipient check (recipient_volunteer_id is not null or recipient_person_id is not null);
create index notification_outbox_person_idx on public.notification_outbox (recipient_person_id) where recipient_person_id is not null;

-- Recipient-safe payload: only what the recipient needs about THEIR request or commitment.
create function public._hub_payload(p_entity_type text, p_entity_id uuid, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    case p_entity_type
      when 'hub_assignments' then (
        select jsonb_build_object('assignment_id', a.id, 'state', a.state, 'scope', a.scope, 'duty', coalesce(a.responsibility_label, case when a.scope = 'venue' then 'Venue cover' else 'help' end),
          'event_id', e.id, 'event_title', coalesce(e.title, v.name), 'venue', coalesce(v.name, ve.name, e.external_location_text),
          'shift_starts_at', coalesce(a.begins_at, e.starts_at), 'shift_ends_at', coalesce(a.ends_at, e.ends_at),
          'demo', coalesce(e.is_demo, false), 'reason', a.cancel_reason)
        from public.hub_assignments a left join public.events e on e.id = a.event_id
        left join public.venues v on v.id = a.venue_id left join public.venues ve on ve.id = e.venue_id
        where a.id = p_entity_id)
      when 'availability_requests' then (
        select jsonb_build_object('request_id', r.id, 'event_id', e.id, 'event_title', e.title, 'venue', coalesce(ve.name, e.external_location_text),
          'shift_starts_at', e.starts_at, 'shift_ends_at', e.ends_at, 'duty', 'help', 'demo', e.is_demo)
        from public.availability_requests r join public.events e on e.id = r.event_id left join public.venues ve on ve.id = e.venue_id
        where r.id = p_entity_id)
    end), '{}'::jsonb) || coalesce(p_extra, '{}'::jsonb)
$$;

-- Queue one Hub message (replaces the Stage 3 no-op). Returns 'queued' or 'not_sent' (no email address
-- or no active Hub login to act on it — the organiser contacts them another way).
create or replace function public._hub_notify(p_kind text, p_person_id uuid, p_entity_type text, p_entity_id uuid,
                                              p_payload jsonb default '{}'::jsonb, p_key text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := case p_kind when 'event_cancelled' then 'hub_event_cancelled' else p_kind end;
  v_payload jsonb;
  v_demo boolean;
  v_name text;
begin
  if p_person_id is null then return 'not_sent'; end if;
  if not exists (select 1 from public.people p join public.user_accounts ua on ua.person_id = p.id
                 where p.id = p_person_id and p.email_normalized is not null and p.lifecycle_status = 'active'
                   and ua.enabled and ua.auth_user_id is not null) then
    return 'not_sent';
  end if;
  -- Organiser messages name only the person who answered THEIR request.
  if v_kind in ('assignment_confirmed', 'assignment_declined', 'assignment_withdrawn') and (p_payload ? 'person_id') then
    select coalesce(display_name, full_name) into v_name from public.people where id = (p_payload ->> 'person_id')::uuid;
  end if;
  v_payload := public._hub_payload(p_entity_type, p_entity_id, jsonb_build_object('person_name', v_name));
  v_demo := coalesce((v_payload ->> 'demo')::boolean, false);
  insert into public.notification_outbox (recipient_person_id, kind, entity_type, entity_id, dedupe_key, payload, status)
  values (p_person_id, v_kind, p_entity_type, p_entity_id, coalesce(p_key, v_kind || ':' || p_entity_id || ':' || extract(epoch from now())::bigint),
          v_payload, case when v_demo then 'suppressed'::public.notification_status else 'pending' end)
  on conflict (dedupe_key) do nothing;
  return case when v_demo then 'not_sent' else 'queued' end;
end;
$$;

-- Why a pending message should no longer be sent (NULL = still true). Legacy cases unchanged; Hub
-- cases: the request/invitation must still be open, the commitment still in the described state.
create or replace function public._outbox_obsolete_reason(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when o.entity_type = 'assignments' and o.kind <> 'reminder' then (
      case
        when a.id is null then 'duty_gone'
        when a.status::text is distinct from (o.payload ->> 'status') then 'status_changed'
        when exists (select 1 from public.notification_outbox n
                     where n.entity_type = 'assignments' and n.entity_id = o.entity_id and n.kind <> 'reminder'
                       and n.recipient_volunteer_id = o.recipient_volunteer_id and n.created_at > o.created_at)
          then 'superseded'
      end)
    when o.kind = 'cancellation_requested' then (
      case when exists (select 1 from public.cancellation_requests c where c.id = o.entity_id and c.status = 'pending')
           then null else 'request_resolved' end)
    when o.kind = 'venue_cover_at_risk' then (
      case when exists (select 1 from public.events e where e.id = o.entity_id
                          and e.status in ('draft', 'published', 'postponed') and e.ends_at > now())
           then null else 'event_closed' end)
    when o.entity_type = 'availability_requests' then (
      case
        when r.id is null then 'request_gone'
        when re.status <> 'published' or not re.volunteers_enabled then 'event_not_open'
        when coalesce(re.ends_at, re.starts_at + interval '6 hours') <= now() then 'event_over'
        when exists (select 1 from public.event_availability ea where ea.event_id = r.event_id and ea.person_id = r.person_id) then 'already_replied'
      end)
    when o.entity_type = 'hub_assignments' then (
      case
        when ha.id is null then 'commitment_gone'
        when he.id is not null and he.status = 'cancelled' and o.kind <> 'hub_event_cancelled' then 'event_cancelled'
        when o.kind in ('assignment_request', 'venue_cover_request') and ha.state <> 'pending' then 'already_answered'
        when o.kind = 'assignment_reconfirm' and ha.state <> 'needs_reconfirmation' then 'already_answered'
        when o.kind = 'hub_reminder' and (ha.state <> 'confirmed'
             or coalesce(ha.begins_at, he.starts_at) is distinct from (o.payload ->> 'shift_starts_at')::timestamptz) then 'commitment_changed'
      end)
  end
  from public.notification_outbox o
  left join public.assignments a on o.entity_type = 'assignments' and a.id = o.entity_id
  left join public.availability_requests r on o.entity_type = 'availability_requests' and r.id = o.entity_id
  left join public.events re on re.id = r.event_id
  left join public.hub_assignments ha on o.entity_type = 'hub_assignments' and ha.id = o.entity_id
  left join public.events he on he.id = ha.event_id
  where o.id = p_id
$$;

-- Active recipient (legacy volunteer or Hub person with an enabled login).
create function public._outbox_recipient_active(p_volunteer uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_person is not null then exists (
                select 1 from public.people p join public.user_accounts ua on ua.person_id = p.id
                where p.id = p_person and p.lifecycle_status = 'active' and ua.enabled and p.email_normalized is not null)
              else exists (select 1 from public.volunteers v where v.id = p_volunteer and v.is_active) end
$$;

create or replace function public.outbox_claim(p_limit int default 25)
returns table (id uuid, kind text, dedupe_key text, payload jsonb, attempt_count int,
               recipient_email text, recipient_name text)
language plpgsql security definer set search_path = '' as $$
declare v_from timestamptz := (select cs.email_released_from from public.club_settings cs where cs.id = 1);
begin
  update public.notification_outbox o set status = 'pending'
   where o.status = 'sending' and o.claimed_at < now() - interval '10 minutes';
  if v_from is null then return; end if;
  update public.notification_outbox o set status = 'suppressed', error = 'recipient_inactive'
   where o.status = 'pending' and o.send_after <= now() and o.created_at >= v_from
     and not public._outbox_recipient_active(o.recipient_volunteer_id, o.recipient_person_id);
  update public.notification_outbox o set status = 'suppressed', error = 'duty_no_longer_active'
   where o.status = 'pending' and o.send_after <= now() and o.created_at >= v_from and o.kind = 'reminder'
     and not exists (
       select 1 from public.assignments a
       join public.event_shifts s on s.id = a.shift_id
       join public.events e on e.id = s.event_id
       where a.id = o.entity_id and a.status = 'confirmed' and s.status = 'active'
         and e.status = 'published' and s.starts_at > now());
  update public.notification_outbox o set status = 'suppressed', error = r.reason
    from (select x.id, public._outbox_obsolete_reason(x.id) as reason from public.notification_outbox x
          where x.status = 'pending' and x.send_after <= now() and x.created_at >= v_from) r
   where o.id = r.id and r.reason is not null;
  -- Hub: a request whose message is suppressed shows as "not sent" to the organiser.
  update public.availability_requests r set delivery_state = 'not_sent'
    from public.notification_outbox o
   where o.entity_type = 'availability_requests' and o.entity_id = r.id and o.status = 'suppressed' and r.delivery_state = 'queued';
  return query
  with due as (
    select o.id from public.notification_outbox o
    where o.status = 'pending' and o.send_after <= now() and o.created_at >= v_from
    order by o.send_after, o.created_at
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  ), claimed as (
    update public.notification_outbox o
       set status = 'sending', attempt_count = o.attempt_count + 1, claimed_at = now(), last_attempt_at = now()
      from due where o.id = due.id
    returning o.id, o.kind, o.dedupe_key, o.payload, o.attempt_count, o.recipient_volunteer_id, o.recipient_person_id
  )
  select c.id, c.kind, c.dedupe_key, c.payload, c.attempt_count,
         coalesce(v.email::text, p.email_normalized::text), coalesce(v.display_name, p.display_name, p.full_name)
  from claimed c
  left join public.volunteers v on v.id = c.recipient_volunteer_id
  left join public.people p on p.id = c.recipient_person_id;
end;
$$;

-- Result recording, now also reflected on the availability request the organiser sees.
create or replace function public.outbox_complete(p_id uuid, p_ok boolean, p_error text default null,
                                                  p_provider_message_id text default null, p_retryable boolean default true)
returns public.notification_status
language plpgsql security definer set search_path = '' as $$
declare v public.notification_outbox%rowtype; v_status public.notification_status;
begin
  select * into v from public.notification_outbox where id = p_id for update;
  if not found or v.status <> 'sending' then return v.status; end if;
  if p_ok then
    update public.notification_outbox set status = 'sent', sent_at = now(), error = null,
           provider_message_id = left(p_provider_message_id, 200) where id = p_id;
    v_status := 'sent';
  else
    v_status := case when p_retryable and v.attempt_count < 5 then 'pending' else 'failed' end;
    update public.notification_outbox
       set status = v_status, error = left(regexp_replace(coalesce(p_error, 'unknown error'), '[^\s@]+@[^\s@]+', '[email]', 'g'), 300),
           send_after = case when v_status = 'pending' then now() + make_interval(mins => power(2, v.attempt_count)::int) else send_after end
     where id = p_id;
  end if;
  if v.entity_type = 'availability_requests' and v_status in ('sent', 'failed') then
    update public.availability_requests set delivery_state = v_status::text, sent_at = case when v_status = 'sent' then now() else sent_at end
     where id = v.entity_id and delivery_state in ('queued', 'failed', 'not_sent');
  end if;
  return v_status;
end;
$$;

create or replace function public.outbox_suppress(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.notification_outbox%rowtype;
begin
  update public.notification_outbox set status = 'suppressed', error = left(p_reason, 100)
   where id = p_id and status in ('pending', 'sending') returning * into v;
  if v.entity_type = 'availability_requests' then
    update public.availability_requests set delivery_state = 'not_sent' where id = v.entity_id and delivery_state = 'queued';
  end if;
end;
$$;

-- Day-before reminders, now also for confirmed Hub commitments (event or venue cover).
create or replace function public.outbox_enqueue_reminders(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := coalesce((select timezone from public.club_settings where id = 1), 'Europe/London');
  v_on boolean := coalesce((select reminder_day_before from public.club_settings where id = 1), true);
  v_tomorrow date := (p_now at time zone v_tz)::date + 1;
  v_due timestamptz := ((v_tomorrow - 1) + time '18:00') at time zone v_tz;
  r record;
  n int := 0;
begin
  if not v_on then return 0; end if;
  if (select email_released_from from public.club_settings where id = 1) is null then return 0; end if;
  for r in
    select a.id, a.volunteer_id, e.is_demo
    from public.assignments a
    join public.event_shifts s on s.id = a.shift_id
    join public.events e on e.id = s.event_id
    join public.volunteers vol on vol.id = a.volunteer_id
    where a.status = 'confirmed' and s.status = 'active' and e.status = 'published' and vol.is_active
      and (s.starts_at at time zone v_tz)::date = v_tomorrow
      and not exists (select 1 from public.notification_outbox o where o.dedupe_key = format('reminder:%s:%s', a.id, v_tomorrow))
  loop
    perform public._enqueue(r.volunteer_id, 'reminder', 'assignments', r.id, format('reminder:%s:%s', r.id, v_tomorrow),
                            public._assignment_payload(r.id), r.is_demo, greatest(p_now, v_due));
    n := n + 1;
  end loop;
  for r in
    select ha.id, ha.person_id
    from public.hub_assignments ha left join public.events e on e.id = ha.event_id
    where ha.state = 'confirmed' and (e.id is null or e.status = 'published')
      and (coalesce(ha.begins_at, e.starts_at) at time zone v_tz)::date = v_tomorrow
      and not exists (select 1 from public.notification_outbox o where o.dedupe_key = format('hub_reminder:%s:%s', ha.id, v_tomorrow))
  loop
    if public._hub_notify('hub_reminder', r.person_id, 'hub_assignments', r.id, '{}'::jsonb, format('hub_reminder:%s:%s', r.id, v_tomorrow)) = 'queued' then
      update public.notification_outbox set send_after = greatest(p_now, v_due) where dedupe_key = format('hub_reminder:%s:%s', r.id, v_tomorrow);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Admin email tools: Hub administrators as well as legacy ones. Still no addresses, names or content.
create or replace function public.admin_outbox_summary()
returns table (status public.notification_status, kind text, message_count int, last_error text, oldest_due timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin() or public.hub_is_admin()) then return; end if;
  return query
  select o.status, o.kind, count(*)::int,
         (array_agg(o.error order by o.last_attempt_at desc nulls last) filter (where o.error is not null))[1],
         min(o.send_after)
  from public.notification_outbox o
  where o.created_at > now() - interval '30 days'
  group by o.status, o.kind
  order by o.status, o.kind;
end;
$$;

create or replace function public.admin_retry_failed_emails() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not (public.is_admin() or public.hub_is_admin()) then perform public._fail('not_authorised', 'Only an administrator can retry emails.'); end if;
  update public.notification_outbox set status = 'pending', attempt_count = 0, send_after = now(), error = null
   where status = 'failed' and created_at > now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.admin_email_backlog()
returns table (kind text, held int, still_current int, out_of_date int, recipients int, oldest timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := (select cs.email_released_from from public.club_settings cs where cs.id = 1);
begin
  if not (public.is_admin() or public.hub_is_admin()) then return; end if;
  return query
  select o.kind, count(*)::int,
         count(*) filter (where public._outbox_obsolete_reason(o.id) is null and public._outbox_recipient_active(o.recipient_volunteer_id, o.recipient_person_id))::int,
         count(*) filter (where public._outbox_obsolete_reason(o.id) is not null or not public._outbox_recipient_active(o.recipient_volunteer_id, o.recipient_person_id))::int,
         count(distinct coalesce(o.recipient_volunteer_id, o.recipient_person_id)) filter (
           where public._outbox_obsolete_reason(o.id) is null and public._outbox_recipient_active(o.recipient_volunteer_id, o.recipient_person_id))::int,
         min(o.created_at)
  from public.notification_outbox o
  where o.status = 'pending' and (v_from is null or o.created_at < v_from)
  group by o.kind
  order by o.kind;
end;
$$;

create or replace function public.admin_set_email_release(p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := (select email_released_from from public.club_settings where id = 1);
  v_held_before timestamptz := coalesce(v_from, 'infinity'::timestamptz);
  n_out int := 0; n_held int := 0;
begin
  if not (public.is_admin() or public.hub_is_admin()) then perform public._fail('not_authorised', 'Only an administrator can start or pause email.'); end if;
  if p_mode = 'pause' then
    update public.club_settings set email_released_from = null where id = 1;
    return jsonb_build_object('mode', 'pause');
  elsif p_mode not in ('new_only', 'include_current') then
    perform public._fail('invalid_mode', 'Choose new emails only, include still-current queued emails, or pause.');
  end if;
  update public.notification_outbox o set status = 'suppressed', error = 'out_of_date_at_release'
   where o.status = 'pending' and o.created_at < v_held_before
     and (public._outbox_obsolete_reason(o.id) is not null or not public._outbox_recipient_active(o.recipient_volunteer_id, o.recipient_person_id));
  get diagnostics n_out = row_count;
  if p_mode = 'new_only' then
    update public.notification_outbox o set status = 'suppressed', error = 'held_before_release'
     where o.status = 'pending' and o.created_at < v_held_before;
    get diagnostics n_held = row_count;
    update public.club_settings set email_released_from = now() where id = 1;
  else
    update public.club_settings set email_released_from = least(now(), coalesce(
      (select min(created_at) from public.notification_outbox where status = 'pending' and created_at < v_held_before), now()))
     where id = 1;
  end if;
  return jsonb_build_object('mode', p_mode, 'suppressed_out_of_date', n_out, 'held_back', n_held);
end;
$$;

-- ---------------------------------------------------------------------------
-- Club settings for the Hub (administrators)
-- ---------------------------------------------------------------------------
create function public.hub_save_settings(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(public._hub_clean(p ->> 'contact_email', 254)); v_months int := nullif(p ->> 'application_retention_months', '')::int;
begin
  perform public._hub_require('admin');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public._fail('invalid_email', 'Enter a valid club contact email, or leave it blank.'); end if;
  if v_months is not null and (v_months < 1 or v_months > 120) then perform public._fail('invalid_retention', 'Choose between 1 and 120 months, or leave it blank.'); end if;
  update public.club_settings set
    reminder_day_before = coalesce((p ->> 'reminder_day_before')::boolean, reminder_day_before),
    contact_email = v_email,
    applications_open = coalesce((p ->> 'applications_open')::boolean, applications_open),
    application_retention_months = v_months
  where id = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privacy: anonymise a leaver on request. Keeps event history (as "Former volunteer"), removes their
-- contact details, notes, preferences and availability, ends Hub access, and anonymises any linked
-- applications. Irreversible; audited without the removed details.
-- ---------------------------------------------------------------------------
create function public.hub_anonymise_person(p_person_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('admin');
begin
  if p_person_id = v_me then perform public._fail('self_lockout', 'You can''t anonymise yourself.'); end if;
  if not exists (select 1 from public.people where id = p_person_id) then perform public._fail('not_found'); end if;
  if exists (select 1 from public.user_accounts where person_id = p_person_id and access_level = 'admin' and enabled)
     and (select count(*) from public.user_accounts ua join public.people p on p.id = ua.person_id
          where ua.access_level = 'admin' and ua.enabled and p.lifecycle_status = 'active' and ua.person_id <> p_person_id) = 0 then
    perform public._fail('last_admin', 'The club must keep at least one active administrator.');
  end if;
  perform set_config('hub.audit_source', 'anonymise', true);
  update public.user_accounts set enabled = false, auth_user_id = null, invite_state = 'not_sent', last_invite_error = null where person_id = p_person_id;
  update public.people set full_name = 'Former volunteer', display_name = null, email_normalized = null, phone_normalized = null,
    preferred_contact_channel = null, notes_private = null, routine_requests_enabled = false, directory_visibility = 'private',
    share_email_with_members = false, share_phone_with_members = false, lifecycle_status = 'inactive'
  where id = p_person_id;
  delete from public.volunteer_preferences where person_id = p_person_id;
  delete from public.usual_availability where person_id = p_person_id;
  delete from public.volunteer_applications where linked_person_id = p_person_id;
  update public.notification_outbox set status = 'suppressed', error = 'anonymised' where recipient_person_id = p_person_id and status = 'pending';
  -- The legacy record (same id) can't hold a null email, so it gets a non-deliverable placeholder.
  update public.volunteers set display_name = 'Former volunteer', phone = null, is_active = false, auth_user_id = null,
    email = 'anonymised-' || replace(p_person_id::text, '-', '') || '@example.invalid'
  where id = p_person_id;
  perform public._hub_audit('person_anonymised', 'people', p_person_id, null, null, 'anonymise');
end;
$$;

grant execute on function public.hub_save_settings(jsonb), public.hub_anonymise_person(uuid) to authenticated;
revoke execute on function public._hub_payload(text, uuid, jsonb), public._outbox_recipient_active(uuid, uuid) from public, anon, authenticated, service_role;

-- Club contact address for the public pages (under-18 route, privacy notice). Secret key only.
create function public.public_club_contact() returns text
language sql stable security definer set search_path = '' as $$
  select contact_email from public.club_settings where id = 1
$$;
revoke execute on function public.public_club_contact() from public, anon, authenticated;
grant execute on function public.public_club_contact() to service_role;

-- Record that an administrator downloaded an export (what and how many rows; never the content).
create function public.hub_log_export(p_kind text, p_rows int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._hub_require('admin');
  perform public._hub_audit('export', left(p_kind, 40), null, null, jsonb_build_object('rows', p_rows), 'export');
end;
$$;
grant execute on function public.hub_log_export(text, int) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261019000700', 'hub_notifications') on conflict (version) do nothing;

-- ====================================================================== 20261019000800_hub_hardening
-- Volunteer Hub — Stage 7 hardening after the independent security review.
-- Additive and reversible (docs/sql/rollback-20261019000800.sql). No data is changed.
--
-- 1. Legacy rota permissions now defer to the Hub. The old helpers read volunteers.role/is_active,
--    so disabling or demoting someone in the Hub left their old admin powers working through the
--    legacy functions. From now on a legacy identity exists only while the same person has an
--    enabled Hub account, and their legacy role IS their Hub access level.
-- 2. Direct INSERT/UPDATE on events (legacy coordinator path) is withdrawn: Hub event changes go
--    only through hub_create_event / hub_update_event, which handle reconfirmation.
-- 3. Admin-only notes are no longer readable by the person they are about (column privileges).
-- 5. Anonymising a person also removes their name from the audit history.
-- 4. Under-18s: not offered to coordinators in the people picker, and their names are not shown to
--    ordinary members on event pages.

-- ---------------------------------------------------------------------------
-- 1. Legacy identity and role follow the Hub account
create or replace function public.current_volunteer_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select v.id from public.volunteers v
  join public.user_accounts ua on ua.person_id = v.id and ua.enabled and ua.auth_user_id = auth.uid()
  join public.people p on p.id = v.id and p.lifecycle_status = 'active'
  where v.auth_user_id = auth.uid() and v.is_active
$$;

create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select case ua.access_level
           when 'admin' then 'admin'::public.app_role
           when 'coordinator' then 'coordinator'::public.app_role
           else 'volunteer'::public.app_role end
  from public.volunteers v
  join public.user_accounts ua on ua.person_id = v.id and ua.enabled and ua.auth_user_id = auth.uid()
  join public.people p on p.id = v.id and p.lifecycle_status = 'active'
  where v.auth_user_id = auth.uid() and v.is_active
$$;

-- Any volunteer row created or changed through a legacy path after the Hub went in is mirrored
-- into people/user_accounts (same id, as the Stage 1 copy did), so the Hub stays the single
-- place where access is granted or removed. Hub-side changes are never copied back.
create function public._hub_mirror_volunteer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_level text := case new.role when 'admin' then 'admin' when 'coordinator' then 'coordinator' else 'member' end;
begin
  if tg_op = 'INSERT' then
    insert into public.people (id, full_name, display_name, email_normalized, lifecycle_status, involvement)
    values (new.id, new.display_name, new.display_name,
            case when exists (select 1 from public.people x where x.email_normalized = lower(new.email::text)) then null else lower(new.email::text) end,
            case when new.is_active then 'active' else 'inactive' end,
            case when new.role in ('admin', 'coordinator') then array['volunteer', 'official'] else array['volunteer'] end)
    on conflict (id) do nothing;
  elsif new.is_active is distinct from old.is_active then
    update public.people set lifecycle_status = case when new.is_active then 'active' else 'inactive' end where id = new.id;
  end if;
  if new.invited_at is not null or new.auth_user_id is not null then
    insert into public.user_accounts (person_id, auth_user_id, access_level, enabled, invited_at, invite_state, linked_at, last_invite_at)
    values (new.id, new.auth_user_id, v_level, new.is_active, new.invited_at, 'sent', new.linked_at, new.invited_at)
    on conflict (person_id) do update set
      auth_user_id = case when tg_op = 'UPDATE' and new.auth_user_id is distinct from old.auth_user_id then excluded.auth_user_id else public.user_accounts.auth_user_id end,
      linked_at    = coalesce(public.user_accounts.linked_at, excluded.linked_at),
      access_level = case when tg_op = 'UPDATE' and new.role is distinct from old.role then excluded.access_level else public.user_accounts.access_level end,
      enabled      = case when tg_op = 'UPDATE' and new.is_active is distinct from old.is_active then excluded.enabled else public.user_accounts.enabled end;
  end if;
  return null;
end;
$$;
revoke all on function public._hub_mirror_volunteer() from public, anon, authenticated;
create trigger volunteers_mirror_to_hub after insert or update of auth_user_id, role, is_active, invited_at, linked_at
  on public.volunteers for each row execute function public._hub_mirror_volunteer();

-- ---------------------------------------------------------------------------
-- 2. No direct event writes from the browser
drop policy if exists events_manager_insert on public.events;
drop policy if exists events_manager_update on public.events;
revoke insert, update on public.events from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Private notes: column-level select for members' own rows
do $$
declare
  r record; cols text;
begin
  for r in select * from (values ('people', 'notes_private'), ('position_holders', 'note_private'), ('position_interests', 'note_private')) as x(t, c)
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = r.t and column_name <> r.c;
    execute format('revoke select on table public.%I from authenticated', r.t);
    execute format('grant select (%s) on table public.%I to authenticated', cols, r.t);
  end loop;
end $$;
-- NOTE: a column added to these tables later must be granted explicitly.

create function public.hub_person_notes(p_person_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._hub_require('admin');
  return (select notes_private from public.people where id = p_person_id);
end;
$$;
revoke all on function public.hub_person_notes(uuid) from public, anon;
grant execute on function public.hub_person_notes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4a. People picker: under-18s only for administrators
create or replace function public.hub_people_picker() returns table (person_id uuid, name text, has_account boolean, email text, phone text, routine boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_admin boolean := public.hub_is_admin();
begin
  if not public.hub_is_manager() then perform public._fail('not_authorised'); end if;
  return query
  select p.id, coalesce(p.display_name, p.full_name),
    exists (select 1 from public.user_accounts ua where ua.person_id = p.id and ua.enabled and ua.auth_user_id is not null),
    p.email_normalized::text, p.phone_normalized, p.routine_requests_enabled
  from public.people p where p.lifecycle_status = 'active' and (v_admin or not p.is_under_18)
  order by lower(coalesce(p.display_name, p.full_name));
end;
$$;

-- 4b. Event page: ordinary members don't see under-18s' names (organisers still do)
alter function public.hub_event_involvement(uuid) rename to _hub_event_involvement_all;
revoke all on function public._hub_event_involvement_all(uuid) from public, anon, authenticated;

create function public.hub_event_involvement(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.current_person_id();
  r jsonb := public._hub_event_involvement_all(p_event_id);
  k text;
begin
  if (r ->> 'can_manage')::boolean then return r; end if;
  foreach k in array array['assignments', 'venue_cover', 'expected', 'availability'] loop
    r := jsonb_set(r, array[k], coalesce((
      select jsonb_agg(x) from jsonb_array_elements(r -> k) x
      where (x ->> 'person_id')::uuid = v_me
         or not exists (select 1 from public.people p where p.id = (x ->> 'person_id')::uuid and p.is_under_18)), '[]'::jsonb));
  end loop;
  return r;
end;
$$;
revoke all on function public.hub_event_involvement(uuid) from public, anon;
grant execute on function public.hub_event_involvement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Anonymise: scrub names from the audit history as well
create or replace function public.hub_anonymise_person(p_person_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('admin');
begin
  if p_person_id = v_me then perform public._fail('self_lockout', 'You can''t anonymise yourself.'); end if;
  if not exists (select 1 from public.people where id = p_person_id) then perform public._fail('not_found'); end if;
  if exists (select 1 from public.user_accounts where person_id = p_person_id and access_level = 'admin' and enabled)
     and (select count(*) from public.user_accounts ua join public.people p on p.id = ua.person_id
          where ua.access_level = 'admin' and ua.enabled and p.lifecycle_status = 'active' and ua.person_id <> p_person_id) = 0 then
    perform public._fail('last_admin', 'The club must keep at least one active administrator.');
  end if;
  perform set_config('hub.audit_source', 'anonymise', true);
  update public.user_accounts set enabled = false, auth_user_id = null, invite_state = 'not_sent', last_invite_error = null where person_id = p_person_id;
  update public.people set full_name = 'Former volunteer', display_name = null, email_normalized = null, phone_normalized = null,
    preferred_contact_channel = null, notes_private = null, routine_requests_enabled = false, directory_visibility = 'private',
    share_email_with_members = false, share_phone_with_members = false, lifecycle_status = 'inactive'
  where id = p_person_id;
  delete from public.volunteer_preferences where person_id = p_person_id;
  delete from public.usual_availability where person_id = p_person_id;
  delete from public.volunteer_applications where linked_person_id = p_person_id;
  update public.notification_outbox set status = 'suppressed', error = 'anonymised' where recipient_person_id = p_person_id and status = 'pending';
  -- The legacy record (same id) can't hold a null email, so it gets a non-deliverable placeholder.
  update public.volunteers set display_name = 'Former volunteer', phone = null, is_active = false, auth_user_id = null,
    email = 'anonymised-' || replace(p_person_id::text, '-', '') || '@example.invalid'
  where id = p_person_id;
  -- Names stay out of the history too (contact details and notes are already redacted when logged).
  update public.audit_log
     set old_data = old_data - 'full_name' - 'display_name' - 'email' - 'phone' - 'notes_private' - 'reason' - 'removal_reason',
         new_data = new_data - 'full_name' - 'display_name' - 'email' - 'phone' - 'notes_private' - 'reason' - 'removal_reason'
   where (entity_type in ('people', 'volunteers', 'user_accounts') and entity_id = p_person_id)
      or (old_data ->> 'person_id')::uuid = p_person_id or (new_data ->> 'person_id')::uuid = p_person_id
      or (old_data ->> 'volunteer_id')::uuid = p_person_id or (new_data ->> 'volunteer_id')::uuid = p_person_id;
  perform public._hub_audit('person_anonymised', 'people', p_person_id, null, null, 'anonymise');
end;
$$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261019000800', 'hub_hardening') on conflict (version) do nothing;

-- Tidy the migration history: drop the 8 auto-timestamped rows from the original connector load
-- (the same steps are recorded under the repository's file names).
delete from supabase_migrations.schema_migrations where version in ('20261017192108','20261017192200','20261017192235','20261017192329','20261017204349','20261017204427','20261017210023','20261017212221');
commit;

select (select count(*) from public.people) as people, (select count(*) from public.user_accounts) as portal_accounts,
       (select count(*) from supabase_migrations.schema_migrations) as migrations_recorded,
       (select active from public.venues where code = 'freemens_way') as freemens_way_active;
