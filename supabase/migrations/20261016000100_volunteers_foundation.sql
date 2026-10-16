-- Phase 1: invitation-only volunteer accounts.
-- Creates only what authentication and route guards need. The full V1 schema follows in Phase 2.
-- Never edit this file after it has been applied anywhere; add a new migration instead.

create extension if not exists citext with schema extensions;

create type public.app_role as enum ('admin', 'coordinator', 'volunteer');

create table public.volunteers (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  email         extensions.citext not null unique,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 80),
  phone         text check (phone is null or char_length(phone) <= 30),
  role          public.app_role not null default 'volunteer',
  is_active     boolean not null default true,
  invited_at    timestamptz,
  linked_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint volunteers_email_format check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table public.volunteers is
  'Club volunteers. Rows are pre-created by an admin before the Auth invite; auth_user_id is linked only by link_volunteer_account().';

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger volunteers_set_updated_at
  before update on public.volunteers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Identity helpers. They return NULL for anyone not linked to an ACTIVE volunteer,
-- so every later RLS policy built on them denies suspended accounts automatically.
-- ---------------------------------------------------------------------------
create function public.current_volunteer_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select v.id from public.volunteers v
  where v.auth_user_id = auth.uid() and v.is_active
$$;

create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select v.role from public.volunteers v
  where v.auth_user_id = auth.uid() and v.is_active
$$;

-- ---------------------------------------------------------------------------
-- Account linking. Called by the trusted /auth/callback and the code-verify action
-- after Supabase Auth has verified the email. Takes NO arguments: identity comes only
-- from auth.uid() and the verified email held by Auth, never from the client.
-- Returns one of: linked | already_linked | not_invited | inactive | unverified | conflict
-- ---------------------------------------------------------------------------
create function public.link_volunteer_account() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text;
  v_confirmed timestamptz;
  v_row       public.volunteers%rowtype;
begin
  if v_uid is null then
    return 'unverified';
  end if;

  select u.email, u.email_confirmed_at into v_email, v_confirmed
  from auth.users u where u.id = v_uid;

  if v_email is null or v_confirmed is null then
    return 'unverified';
  end if;

  -- Already linked to this auth user?
  select * into v_row from public.volunteers where auth_user_id = v_uid for update;
  if found then
    return case when v_row.is_active then 'already_linked' else 'inactive' end;
  end if;

  -- search_path is empty, so name the citext operator explicitly; a bare "=" would
  -- silently fall back to case-SENSITIVE text comparison.
  select * into v_row from public.volunteers
  where email operator(extensions.=) v_email::extensions.citext for update;

  if not found or v_row.invited_at is null then
    return 'not_invited';
  end if;
  if not v_row.is_active then
    return 'inactive';
  end if;
  if v_row.auth_user_id is not null then
    -- Row belongs to a different Auth user: never re-point it silently.
    return 'conflict';
  end if;

  update public.volunteers
     set auth_user_id = v_uid, linked_at = now()
   where id = v_row.id;
  return 'linked';
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security: deny by default.
-- ---------------------------------------------------------------------------
-- (Not FORCE: the SECURITY DEFINER helpers above run as the table owner and must be
--  able to read volunteers to answer "who is calling?" without recursing into RLS.)
alter table public.volunteers enable row level security;

revoke all on table public.volunteers from public, anon, authenticated;

-- An active volunteer may read their own row. Admins may read all rows.
-- (Coordinator venue-scoped visibility is added in Phase 2 with venues.)
grant select on table public.volunteers to authenticated;

create policy volunteers_select_own on public.volunteers
  for select to authenticated
  using (auth_user_id = auth.uid() and is_active);

create policy volunteers_select_admin on public.volunteers
  for select to authenticated
  using (public.current_app_role() = 'admin');

-- Volunteers may edit ONLY their display name and phone. Column-level grants make
-- role, is_active, email, auth_user_id and timestamps unwritable by any client.
grant update (display_name, phone) on table public.volunteers to authenticated;

create policy volunteers_update_own_profile on public.volunteers
  for update to authenticated
  using (auth_user_id = auth.uid() and is_active)
  with check (auth_user_id = auth.uid() and is_active);

-- Functions: only signed-in users may call them; anon may not.
revoke all on function public.current_volunteer_id() from public, anon;
revoke all on function public.current_app_role() from public, anon;
revoke all on function public.link_volunteer_account() from public, anon;
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.current_volunteer_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.link_volunteer_account() to authenticated;
