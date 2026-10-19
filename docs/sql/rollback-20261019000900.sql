-- Rollback for 20261019000900_hub_contact_roles_teams.sql. Run in one transaction.

-- Restores the previous functions and removes the new columns. Contact methods, team leagues/divisions
-- and role kinds/teams entered since are lost (export People and Club roles first).

drop function if exists public.hub_team_staff();

create or replace function public.hub_create_person(p jsonb) returns uuid
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

create or replace function public.hub_update_person(p_person_id uuid, p jsonb) returns void
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

create or replace function public.hub_update_my_profile(p jsonb) returns void
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

create or replace function public.hub_save_position(p_id uuid, p jsonb) returns uuid
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

create or replace function public.hub_positions() returns jsonb
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

create or replace function public.public_opportunities() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'department', p.department, 'summary', p.public_summary, 'responsibilities', p.responsibilities,
    'commitment', p.estimated_commitment, 'location', p.work_location_preference, 'skills', p.skills_desirable || p.skills_required,
    'training_available', p.training_available, 'checks_needed', p.requires_external_safeguarding_review,
    'reason', public._hub_public_reason(p)) order by p.title), '[]'::jsonb)
  from public.club_positions p
  where public._hub_public_reason(p) is not null
$$;

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

drop function if exists public._hub_channels(jsonb);

-- Keep one contact method in the old single-choice column.
update public.people set preferred_contact_channel = case when 'whatsapp' = any(contact_channels) then 'whatsapp' when 'email' = any(contact_channels) then 'email' when 'phone' = any(contact_channels) then 'phone' else preferred_contact_channel end where contact_channels <> '{}';

alter table public.people drop column contact_channels;

alter table public.club_positions drop constraint club_positions_team_only_for_team_roles, drop column team_id, drop column kind;

alter table public.teams drop column league, drop column division;
