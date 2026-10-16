-- Phase 2 (5/5): reference data. Idempotent; identities are stable codes, never display labels.
-- Source: docs/Duty_Catalogue_and_Venue_Templates_V1.md §2. Exactly NINE duty types. No Parking/Steward duty.
-- (Templates T01–T09 are seeded in Phase 3.)

insert into public.venues (code, name, short_name) values
  ('marke_wood',   'Marke Wood',   'Marke Wood'),
  ('freemens_way', 'Freemens Way', 'Freemens Way')
on conflict (code) do update set name = excluded.name, short_name = excluded.short_name;

insert into public.duty_types (code, name, description, requires_authorisation, sort_order) values
  ('site_lead', 'Site lead / duty manager',
   'Named accountable contact for the staffed operational window; authorised/trained by the club. Can include opening, facility checks and closing as included responsibilities.',
   true, 1),
  ('open_unlock', 'Open and unlock facilities',
   'Keyholder/authorised-access role. May be included within the site-lead shift when that volunteer attends from opening.',
   true, 2),
  ('lock_secure', 'Lock and secure facilities',
   'Keyholder/authorised-access role. May be included within the site-lead shift when that volunteer stays until closing.',
   true, 3),
  ('gate_admissions', 'Gate / admission collection',
   'Add only where admission is actually taken. Cash-handling instructions are given privately by an authorised organiser.',
   false, 4),
  ('refreshments', 'Refreshments / tea bar',
   'Add only where the bar is operating. Consider breaks, food handling and safe cash procedures.',
   false, 5),
  ('pitch_setup', 'Pitch and equipment setup',
   'Pitch and equipment preparation as described in the organiser''s instructions. Not a substitute for specialist maintenance qualifications.',
   false, 6),
  ('facility_checks', 'Changing room / facility checks',
   'Ideally included within the site lead''s shift; split off if repeated rounds or separate access/security responsibilities are needed.',
   false, 7),
  ('cleaning', 'Post-event cleaning',
   'Starts at the planned event/operational end, with time for clean-up and waste removal. Specialist tasks need separate arrangements.',
   false, 8),
  ('general_support', 'General volunteer support',
   'The actual task is described in the shift instructions (e.g. helping organise a community day).',
   false, 9)
on conflict (code) do update
  set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;
-- requires_authorisation is deliberately NOT overwritten on re-run: admins may have changed it.

insert into public.club_settings (id) values (1) on conflict (id) do nothing;
