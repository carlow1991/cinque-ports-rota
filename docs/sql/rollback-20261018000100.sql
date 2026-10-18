-- Rollback for 20261018000100_late_cancellation_at_risk.sql: restores the original definition.
-- Safe to run at any time; it changes no data.

create or replace function public.event_site_coverage(p_event_id uuid)
returns table (state text, coverage_event_id uuid, required_window tstzrange, gaps tstzmultirange)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e public.events%rowtype;
  v_c public.events%rowtype;
  v_window tstzrange;
  v_covered tstzmultirange;
  v_gaps tstzmultirange;
  v_has_arrangement boolean;
begin
  if not public.can_manage_event(p_event_id) then return; end if;
  select * into v_e from public.events where id = p_event_id;

  select tstzrange(min(x.s), max(x.e), '[)') into v_window from (
    select v_e.starts_at as s, v_e.ends_at as e
    union all
    select starts_at, ends_at from public.event_shifts where event_id = p_event_id and status = 'active') x;

  if not v_e.site_responsibility or v_e.site_cover_source = 'not_required' then
    return query select 'not_required'::text, v_e.coverage_event_id, v_window, '{}'::tstzmultirange; return;
  end if;
  if v_e.site_cover_source = 'provider_verified' then
    return query select 'covered_by_provider'::text, v_e.coverage_event_id, v_window, '{}'::tstzmultirange; return;
  end if;

  if v_e.coverage_event_id is not null then
    select * into v_c from public.events where id = v_e.coverage_event_id;
    if v_c.status <> 'cancelled' and v_c.site_cover_source = 'provider_verified' then
      return query select 'covered_by_provider'::text, v_c.id, v_window, '{}'::tstzmultirange; return;
    end if;
  end if;

  select range_agg(tstzrange(s.starts_at, s.ends_at, '[)')) into v_covered
  from public.event_shifts s
  join public.duty_types dt on dt.id = s.duty_type_id and dt.code = 'site_lead'
  join public.events ev on ev.id = s.event_id
  where s.status = 'active' and ev.status in ('published', 'completed', 'draft')
    and (s.event_id = v_e.id or (v_c.id is not null and s.event_id = v_c.id and v_c.status <> 'cancelled'))
    and exists (
      select 1 from public.assignments a
      where a.shift_id = s.id and a.status = 'confirmed'
        and public.volunteer_is_eligible(a.volunteer_id, s.id, s.ends_at));

  v_gaps := tstzmultirange(v_window) - coalesce(v_covered, '{}'::tstzmultirange);
  v_has_arrangement := v_c.id is not null or exists (
    select 1 from public.event_shifts s join public.duty_types dt on dt.id = s.duty_type_id
    where s.event_id = v_e.id and s.status = 'active' and dt.code = 'site_lead');

  return query select
    case when isempty(v_gaps) then 'covered_by_volunteer'
         when v_has_arrangement then 'at_risk'
         else 'no_cover' end,
    v_c.id, v_window, v_gaps;
end;
$$;

drop function public.event_cover_leads(uuid);
create function public.event_cover_leads(p_event_id uuid)
returns table (source text, event_id uuid, event_title text, shift_id uuid, starts_at timestamptz, ends_at timestamptz,
               display_name text, status public.assignment_status, authorised boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_cover uuid;
begin
  if not public.can_manage_event(p_event_id) then return; end if;
  select coverage_event_id into v_cover from public.events where id = p_event_id;
  return query
  select case when s.event_id = p_event_id then 'this_event' else 'linked_cover' end,
         e.id, e.title, s.id, s.starts_at, s.ends_at, vol.display_name, a.status,
         case when a.id is null then null else public.volunteer_is_eligible(a.volunteer_id, s.id, s.ends_at) end
  from public.event_shifts s
  join public.events e on e.id = s.event_id
  join public.duty_types dt on dt.id = s.duty_type_id and dt.code = 'site_lead'
  left join public.assignments a on a.shift_id = s.id and a.status in ('invited', 'pending_approval', 'confirmed')
  left join public.volunteers vol on vol.id = a.volunteer_id
  where s.status = 'active' and (s.event_id = p_event_id or (v_cover is not null and s.event_id = v_cover and e.status <> 'cancelled'))
  order by s.starts_at, case a.status when 'confirmed' then 0 when 'pending_approval' then 1 else 2 end;
end;
$$;
revoke execute on function public.event_cover_leads(uuid) from public, anon, service_role;
grant execute on function public.event_cover_leads(uuid) to authenticated;
