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
