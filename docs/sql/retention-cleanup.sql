-- Routine privacy clean-up (privacy guide §5). Run quarterly in Supabase → SQL Editor.
-- Deletes only operational copies, never duty records or people:
--   * email queue entries that finished (sent / not sent / failed) more than 90 days ago
--   * audit history older than 24 months
-- The periods are club decisions (club-decisions.md B4); change the two numbers if agreed.
do $$
declare v_outbox int; v_audit int;
begin
  delete from public.notification_outbox
   where status in ('sent', 'suppressed', 'failed') and created_at < now() - interval '90 days';
  get diagnostics v_outbox = row_count;
  delete from public.audit_log where created_at < now() - interval '24 months';
  get diagnostics v_audit = row_count;
  raise notice 'Removed % old email records and % old audit records.', v_outbox, v_audit;
end $$;
