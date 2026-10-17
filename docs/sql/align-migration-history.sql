-- One-off (17 Oct 2026): the live club database was loaded through the Supabase connector (steps 1-8)
-- and the SQL Editor (steps 9-15), so its migration history doesn't match the repo's file names.
-- Run once in Supabase -> Cinque Ports Rota -> SQL Editor so `supabase db push` later only applies NEW files.
-- Changes only the bookkeeping table; no club data or structure is touched.
begin;
delete from supabase_migrations.schema_migrations;
insert into supabase_migrations.schema_migrations (version, name) values
('20261016000100','volunteers_foundation'),('20261016000200','core_schema'),('20261016000300','integrity_guards'),
('20261016000400','access_and_rls'),('20261016000500','assignment_rpcs'),('20261016000600','seed_reference_data'),
('20261016000700','seed_templates_t01_t09'),('20261016000800','event_building'),('20261016000900','template_admin'),
('20261017000100','volunteer_views'),('20261017000200','function_privileges_lockdown'),('20261017000300','organiser_tools'),
('20261017000400','lead_loss_alerts'),('20261017000500','email_outbox_worker'),('20261017000600','service_role_least_privilege');
commit;
select count(*) as steps_recorded from supabase_migrations.schema_migrations;  -- expect 15
