-- Improvement increment 7 (shared venue cover): split a site-lead duty into two handover shifts.
--
-- split_site_lead_shift(shift, at) turns one site-lead duty (e.g. 08:00–14:00) into two that meet
-- exactly at the handover time (08:00–11:00 and 11:00–14:00), so continuous cover is kept by design.
--   * Only a site-lead duty that hasn't started, on an open event, with nobody invited, awaiting
--     approval or confirmed on it (split first, then fill both halves).
--   * Each part must be at least 15 minutes. Headcount, sign-up/approval settings and instructions
--     are copied.
--   * Opening stays with the FIRST lead (open_unlock is removed from the second part), locking up
--     goes to the SECOND (lock_secure is removed from the first). Other included responsibilities
--     (e.g. facility checks) stay on both. Eligibility then follows automatically: each lead needs
--     the authorisations of their own part.
--   * Both parts become hand-made duties (the template link is cleared), so moving the event later
--     moves them together instead of re-stretching the first back to the template's full window.
-- Audited by the existing row triggers. Rollback: docs/sql/rollback-20261018000600.sql (drops the
-- function; any duties already split stay as two duties).

create function public.split_site_lead_shift(p_shift_id uuid, p_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_s public.event_shifts%rowtype;
  v_e public.events%rowtype;
  v_code text;
  v_new uuid;
begin
  select * into v_s from public.event_shifts where id = p_shift_id for update;
  if not found then perform public._fail('not_found', 'Duty not found.'); end if;
  select * into v_e from public.events where id = v_s.event_id for update;
  if not public.can_manage_event(v_e.id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  select code into v_code from public.duty_types where id = v_s.duty_type_id;
  if v_code <> 'site_lead' then perform public._fail('not_site_lead', 'Only a site-lead duty can be split into a handover.'); end if;
  if v_s.status <> 'active' or v_e.status not in ('draft', 'published', 'postponed') then
    perform public._fail('invalid_transition', 'This duty or event is closed.');
  end if;
  if v_s.starts_at <= now() then perform public._fail('shift_started', 'This duty has already started.'); end if;
  if p_at is null or p_at < v_s.starts_at + interval '15 minutes' or p_at > v_s.ends_at - interval '15 minutes' then
    perform public._fail('invalid_handover', 'Choose a handover time at least 15 minutes after the start and before the end.');
  end if;
  if exists (select 1 from public.assignments a where a.shift_id = p_shift_id and a.status in ('invited', 'pending_approval', 'confirmed')) then
    perform public._fail('shift_has_people', 'Someone is already on this duty. Split it before anyone is invited or signed up.');
  end if;

  insert into public.event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count, signup_enabled, approval_required, instructions)
  values (v_s.event_id, v_s.duty_type_id, p_at, v_s.ends_at, v_s.required_count, v_s.signup_enabled, v_s.approval_required, v_s.instructions)
  returning id into v_new;
  update public.event_shifts set ends_at = p_at, source_template_item_id = null where id = p_shift_id;

  -- Second part: everything the original included except opening up.
  insert into public.event_shift_responsibilities (shift_id, duty_type_id)
  select v_new, r.duty_type_id from public.event_shift_responsibilities r
  join public.duty_types d on d.id = r.duty_type_id
  where r.shift_id = p_shift_id and d.code <> 'open_unlock';
  -- First part: no longer locks up.
  delete from public.event_shift_responsibilities r using public.duty_types d
   where r.shift_id = p_shift_id and d.id = r.duty_type_id and d.code = 'lock_secure';

  return jsonb_build_object('first_shift_id', p_shift_id, 'second_shift_id', v_new);
end;
$$;

revoke execute on function public.split_site_lead_shift(uuid, timestamptz) from public, anon, service_role;
grant execute on function public.split_site_lead_shift(uuid, timestamptz) to authenticated;
