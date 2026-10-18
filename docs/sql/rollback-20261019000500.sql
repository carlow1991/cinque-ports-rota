-- Rollback for 20261019000500_hub_positions.sql (Volunteer Hub · Stage 5).
-- Drops club roles, postholders and interest records (export them first) and restores the Stage 1
-- directory function. Run in one transaction:  psql -1 -f this-file

drop function if exists public.public_opportunities();
drop function if exists public.hub_positions();
drop function if exists public.hub_add_suggested_positions();
drop function if exists public.hub_register_interest(uuid, text);
drop function if exists public.hub_set_interest(uuid, uuid, uuid, text, text);
drop function if exists public.hub_end_holder(uuid, date);
drop function if exists public.hub_add_holder(uuid, uuid, date, text, text);
drop function if exists public.hub_set_recruiting(uuid, boolean, boolean, boolean);
drop function if exists public.hub_save_position(uuid, jsonb);

drop function public.hub_directory();
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
grant execute on function public.hub_directory() to authenticated;

drop function if exists public._hub_public_reason(public.club_positions);
drop function if exists public._hub_occupancy(uuid);
drop function if exists public._hub_holders_on(uuid, date);
drop table if exists public.position_interests;
drop table if exists public.position_holders;
drop table if exists public.club_positions;
