-- Improvement increment 4 (volunteer home): duty-level opportunities for the signed-in volunteer.
-- Read-only. Uses exactly the same rules as volunteer_rota's eligible_open_slots: a published
-- event, a sign-up duty that has not started, a free place, the caller authorised for it, not
-- already on it (or cancelled from it), and no clash with their own commitments. Returns only
-- counts and the caller's own eligibility, never anyone else's identity.
--
-- Rollback: drop function public.volunteer_opportunities(timestamptz, timestamptz, int);
-- (docs/sql/rollback-20261018000300.sql). Nothing else depends on it in the database.

create function public.volunteer_opportunities(p_from timestamptz, p_to timestamptz, p_limit int default 12)
returns table (
  shift_id uuid, event_id uuid, event_title text, event_type public.event_type, venue_name text, team_name text,
  duty_name text, responsibilities text[], starts_at timestamptz, ends_at timestamptz,
  open_slots int, approval_required boolean, is_demo boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public.current_volunteer_id();
begin
  if v_me is null then return; end if;
  return query
  select s.id, e.id, e.title, e.event_type, v.name, t.name, dt.name,
         coalesce((select array_agg(rd.name order by rd.sort_order) from public.event_shift_responsibilities r
                   join public.duty_types rd on rd.id = r.duty_type_id where r.shift_id = s.id), '{}'),
         s.starts_at, s.ends_at, greatest(0, s.required_count - c.confirmed - c.pending)::int,
         s.approval_required, e.is_demo
  from public.event_shifts s
  join public.events e on e.id = s.event_id
  join public.venues v on v.id = e.venue_id
  left join public.teams t on t.id = e.team_id
  join public.duty_types dt on dt.id = s.duty_type_id
  cross join lateral public._shift_counts(s.id) c
  where e.status = 'published' and s.status = 'active' and s.signup_enabled
    and s.starts_at > now() and s.starts_at >= p_from and s.starts_at < p_to
    and s.required_count - c.confirmed - c.pending > 0
    and not exists (select 1 from public.assignments a where a.shift_id = s.id and a.volunteer_id = v_me
                    and a.status in ('invited', 'pending_approval', 'confirmed', 'cancelled'))
    and cardinality(public.missing_authorisations(v_me, s.id, s.ends_at)) = 0
    and not public._has_overlap(v_me, s.id)
  order by s.starts_at, dt.sort_order, s.id
  limit least(greatest(coalesce(p_limit, 12), 1), 50);
end;
$$;

revoke execute on function public.volunteer_opportunities(timestamptz, timestamptz, int) from public, anon, service_role;
grant execute on function public.volunteer_opportunities(timestamptz, timestamptz, int) to authenticated;
