-- Phase 5: Catalogue §7.8. When a CONFIRMED site lead on a venue-wide cover event stops being
-- confirmed (withdraws, is removed, late cancellation approved, reset for reconfirmation, or the
-- shift is cancelled), alert the organisers of EVERY event linked to that cover. This fires from
-- the data itself, so no code path can forget it.

create function public.alert_on_lead_loss() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  if old.status = 'confirmed' and new.status <> 'confirmed' then
    select e.id into v_event
    from public.event_shifts s
    join public.events e on e.id = s.event_id
    join public.duty_types dt on dt.id = s.duty_type_id
    where s.id = new.shift_id and dt.code = 'site_lead' and e.event_type = 'venue_coverage';
    if v_event is not null then
      perform public._alert_dependent_events(v_event);
    end if;
  end if;
  return null;
end;
$$;

create trigger assignments_alert_on_lead_loss
  after update of status on public.assignments
  for each row execute function public.alert_on_lead_loss();

revoke execute on function public.alert_on_lead_loss() from public, anon, authenticated;
