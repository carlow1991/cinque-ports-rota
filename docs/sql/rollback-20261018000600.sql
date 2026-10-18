-- Rollback for 20261018000600_split_site_lead.sql. Duties already split stay as two duties.
drop function if exists public.split_site_lead_shift(uuid, timestamptz);
