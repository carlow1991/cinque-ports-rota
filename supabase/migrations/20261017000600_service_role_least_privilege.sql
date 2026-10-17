-- Phase 7 security review: least privilege for the server-only secret key (role service_role).
--
-- Hosted Supabase grants service_role ALL on every table, function and sequence created in
-- public (and the role bypasses RLS). The app only needs that key for:
--   * the email worker      → the four outbox_* functions (Phase 6)
--   * the bootstrap script  → admin_bootstrap_volunteer() below (creating the very first admin)
--   * Auth invitations      → Supabase's Auth service, which doesn't touch these tables
-- So a leaked or misused key can no longer read rosters, phone numbers or audit history through
-- the Data API. anon and authenticated were already locked down (Phase 2/4); sequences are added
-- here for completeness. The Supabase dashboard (role postgres) is unaffected.

revoke all on all tables in schema public from service_role;
revoke all on all sequences in schema public from service_role, anon, authenticated;
revoke execute on all functions in schema public from service_role;
alter default privileges in schema public revoke all on tables from service_role;
alter default privileges in schema public revoke all on sequences from service_role, anon, authenticated;
alter default privileges in schema public revoke execute on functions from service_role;

-- Create or re-activate a volunteer and set their role, for the trusted-machine bootstrap script
-- (scripts/invite-volunteer.mts). Same rules as admin_create_volunteer(), minus the "caller must be
-- an admin" check, which is impossible before the first admin exists. Callable ONLY with the
-- secret key. Never removes the last active admin.
create function public.admin_bootstrap_volunteer(p_email text, p_display_name text, p_role public.app_role default 'volunteer')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_row public.volunteers%rowtype;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then perform public._fail('invalid_email', 'Enter a valid email address.'); end if;
  if v_name = '' or length(v_name) > 80 then perform public._fail('invalid_name', 'Enter a name (up to 80 characters).'); end if;
  select * into v_row from public.volunteers where email operator(extensions.=) v_email::extensions.citext for update;
  if found then
    if v_row.role = 'admin' and p_role <> 'admin' and v_row.is_active
       and (select count(*) from public.volunteers where role = 'admin' and is_active and id <> v_row.id) = 0 then
      perform public._fail('last_admin', 'The club must keep at least one active administrator.');
    end if;
    update public.volunteers set display_name = v_name, role = p_role, is_active = true, invited_at = now() where id = v_row.id;
    return jsonb_build_object('volunteer_id', v_row.id, 'already_linked', v_row.auth_user_id is not null, 'existing', true);
  end if;
  insert into public.volunteers (email, display_name, role, is_active, invited_at)
  values (v_email, v_name, p_role, true, now()) returning * into v_row;
  return jsonb_build_object('volunteer_id', v_row.id, 'already_linked', false, 'existing', false);
end;
$$;

revoke execute on function public.admin_bootstrap_volunteer(text, text, public.app_role) from public, anon, authenticated;

grant usage on schema public to service_role;
grant execute on function
  public.outbox_enqueue_reminders(timestamptz), public.outbox_claim(int),
  public.outbox_complete(uuid, boolean, text, text, boolean), public.outbox_suppress(uuid, text),
  public.admin_bootstrap_volunteer(text, text, public.app_role)
to service_role;
