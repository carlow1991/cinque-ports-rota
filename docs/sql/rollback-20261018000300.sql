-- Rollback for 20261018000300_volunteer_opportunities.sql. Changes no data.
drop function if exists public.volunteer_opportunities(timestamptz, timestamptz, int);
