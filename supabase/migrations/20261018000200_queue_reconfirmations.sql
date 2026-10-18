-- Improvement increment 3 (organiser overview): the action queue tells reconfirmations apart from
-- fresh invitations. An assignment that went back to "invited" from confirmed or awaiting approval
-- (event postponed or times changed) is reported as kind 'reconfirmation'. Worked out from the
-- existing audit_log; nothing is stored or changed. Same signature and return type, so
-- CREATE OR REPLACE keeps the existing grant (authenticated only).
--
-- Rollback: docs/sql/rollback-20261018000200.sql (the previous definition). No data is touched.

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
    select case
             when a.status = 'pending_approval' then 'approval'
             -- Back to "invited" from confirmed / awaiting approval = the event moved and they must
             -- reconfirm (_reset_assignments_for_reconfirm). Read from the existing audit trail.
             when (select al.old_data ->> 'status' from public.audit_log al
                   where al.entity_type = 'assignments' and al.entity_id = a.id and al.action = 'update'
                     and al.old_data ->> 'status' is distinct from al.new_data ->> 'status'
                   order by al.id desc limit 1) in ('confirmed', 'pending_approval') then 'reconfirmation'
             else 'invitation' end::text,
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
  order by case x.k when 'cancellation' then 0 when 'approval' then 1 when 'reconfirmation' then 2 else 3 end, x.ss;
end;
$$;
