-- Rollback for 20261018000200_queue_reconfirmations.sql: restores the previous definition. Changes no data.

create or replace function public.manage_action_queue()
returns table (
  kind text, assignment_id uuid, request_id uuid, event_id uuid, event_title text, venue_name text,
  duty_name text, shift_starts_at timestamptz, shift_ends_at timestamptz, display_name text, reason text, since timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_manager() then return; end if;
  return query
  select x.* from (
    select case a.status when 'pending_approval' then 'approval' else 'invitation' end::text,
           a.id, null::uuid, e.id, e.title, v.name, dt.name, s.starts_at, s.ends_at, vol.display_name, null::text, a.status_changed_at
    from public.assignments a
    join public.event_shifts s on s.id = a.shift_id and s.status = 'active'
    join public.events e on e.id = s.event_id and e.status in ('published', 'postponed')
    join public.venues v on v.id = e.venue_id
    join public.duty_types dt on dt.id = s.duty_type_id
    join public.volunteers vol on vol.id = a.volunteer_id
    where a.status in ('pending_approval', 'invited') and s.starts_at > now() and public.can_manage_venue(e.venue_id)
    union all
    select 'cancellation', a.id, cr.id, e.id, e.title, v.name, dt.name, s.starts_at, s.ends_at, vol.display_name, cr.reason, cr.created_at
    from public.cancellation_requests cr
    join public.assignments a on a.id = cr.assignment_id
    join public.event_shifts s on s.id = a.shift_id
    join public.events e on e.id = s.event_id
    join public.venues v on v.id = e.venue_id
    join public.duty_types dt on dt.id = s.duty_type_id
    join public.volunteers vol on vol.id = a.volunteer_id
    where cr.status = 'pending' and public.can_manage_venue(e.venue_id)
  ) x(k, aid, rid, eid, etitle, vname, dname, ss, se, vol_name, rsn, since_at)
  order by case x.k when 'cancellation' then 0 when 'approval' then 1 else 2 end, x.ss;
end;
$$;
