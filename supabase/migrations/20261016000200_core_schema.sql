-- Phase 2 (1/5): full V1 schema. Tables, enums, constraints and indexes only.
-- Security (RLS, grants, functions) follows in later Phase 2 migrations.

-- ---------------------------------------------------------------------------
-- Enumerations (Spec §E)
-- ---------------------------------------------------------------------------
create type public.event_type as enum
  ('fixture', 'training', 'meeting', 'maintenance', 'fundraising', 'club_event', 'venue_coverage', 'other');
create type public.event_status as enum ('draft', 'published', 'postponed', 'cancelled', 'completed');
create type public.shift_status as enum ('active', 'cancelled');
create type public.assignment_status as enum
  ('invited', 'pending_approval', 'confirmed', 'declined', 'withdrawn', 'removed', 'cancelled');
create type public.assignment_source as enum ('self_signup', 'admin_allocation');
create type public.attendance_status as enum ('not_recorded', 'present', 'absent');
-- 'suppressed' (beyond the spec's four) marks messages that must never be sent:
-- demo data, or reminders for assignments that are no longer active.
create type public.notification_status as enum ('pending', 'sending', 'sent', 'failed', 'suppressed');
create type public.template_time_anchor as enum ('event_start', 'event_end');
create type public.site_cover_source as enum ('club_volunteer', 'provider_verified', 'not_required');
create type public.cancellation_request_status as enum ('pending', 'approved', 'declined');

-- ---------------------------------------------------------------------------
-- Venues & teams
-- ---------------------------------------------------------------------------
create table public.venues (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name        text not null unique check (char_length(btrim(name)) between 1 and 80),
  short_name  text not null check (char_length(btrim(short_name)) between 1 and 30),
  address     text check (address is null or char_length(address) <= 300),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(btrim(name)) between 1 and 80),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.volunteers
  add column preferred_venue_id uuid references public.venues (id) on delete set null;

create table public.coordinator_venues (
  volunteer_id uuid not null references public.volunteers (id) on delete cascade,
  venue_id     uuid not null references public.venues (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (volunteer_id, venue_id)
);
create index coordinator_venues_venue_idx on public.coordinator_venues (venue_id);

-- ---------------------------------------------------------------------------
-- Duty catalogue & authorisations (no DBS data, ever)
-- ---------------------------------------------------------------------------
create table public.duty_types (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique check (code ~ '^[a-z][a-z_]{1,39}$'),
  name                    text not null check (char_length(btrim(name)) between 1 and 80),
  description             text check (description is null or char_length(description) <= 1000),
  requires_authorisation  boolean not null default false,
  active                  boolean not null default true,
  sort_order              integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table public.volunteer_duty_authorisations (
  id            uuid primary key default gen_random_uuid(),
  volunteer_id  uuid not null references public.volunteers (id) on delete cascade,
  duty_type_id  uuid not null references public.duty_types (id) on delete restrict,
  approved_by   uuid references public.volunteers (id) on delete set null,
  approved_at   timestamptz not null default now(),
  valid_until   timestamptz,
  active        boolean not null default true,
  updated_at    timestamptz not null default now(),
  unique (volunteer_id, duty_type_id)
);
comment on table public.volunteer_duty_authorisations is
  'Minimal club-issued eligibility flag + expiry. Never store DBS certificates, numbers or safeguarding notes here.';

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
create table public.duty_templates (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  description  text check (description is null or char_length(description) <= 2000),
  event_type   public.event_type not null,
  venue_id     uuid references public.venues (id) on delete restrict,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.duty_template_items (
  id                          uuid primary key default gen_random_uuid(),
  template_id                 uuid not null references public.duty_templates (id) on delete cascade,
  duty_type_id                uuid not null references public.duty_types (id) on delete restrict,
  start_anchor                public.template_time_anchor not null default 'event_start',
  start_offset_minutes        integer not null default 0 check (start_offset_minutes between -1440 and 1440),
  end_anchor                  public.template_time_anchor not null default 'event_end',
  end_offset_minutes          integer not null default 0 check (end_offset_minutes between -1440 and 1440),
  required_count              integer not null default 1 check (required_count between 1 and 50),
  enabled_by_default          boolean not null default true,
  when_to_enable              text check (when_to_enable is null or char_length(when_to_enable) <= 500),
  signup_enabled              boolean not null default true,
  approval_required           boolean not null default false,
  suppressed_by_linked_cover  boolean not null default false,
  instructions                text check (instructions is null or char_length(instructions) <= 2000),
  sort_order                  integer not null default 0,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (template_id, sort_order)
);
create index duty_template_items_template_idx on public.duty_template_items (template_id);

create table public.template_item_responsibilities (
  template_item_id  uuid not null references public.duty_template_items (id) on delete cascade,
  duty_type_id      uuid not null references public.duty_types (id) on delete restrict,
  primary key (template_item_id, duty_type_id)
);

-- ---------------------------------------------------------------------------
-- Events & shifts
-- ---------------------------------------------------------------------------
create table public.events (
  id                          uuid primary key default gen_random_uuid(),
  venue_id                    uuid not null references public.venues (id) on delete restrict,
  team_id                     uuid references public.teams (id) on delete set null,
  coverage_event_id           uuid references public.events (id) on delete restrict,
  title                       text not null check (char_length(btrim(title)) between 1 and 120),
  event_type                  public.event_type not null,
  starts_at                   timestamptz not null,
  ends_at                     timestamptz not null,
  kickoff_at                  timestamptz,
  opponent                    text check (opponent is null or char_length(opponent) <= 120),
  competition                 text check (competition is null or char_length(competition) <= 120),
  description                 text check (description is null or char_length(description) <= 4000),
  instructions                text check (instructions is null or char_length(instructions) <= 4000),
  status                      public.event_status not null default 'draft',
  site_responsibility         boolean not null default true,
  site_cover_source           public.site_cover_source not null default 'club_volunteer',
  external_cover_note         text check (external_cover_note is null or char_length(external_cover_note) <= 1000),
  external_cover_verified_by  uuid references public.volunteers (id) on delete set null,
  external_cover_verified_at  timestamptz,
  is_demo                     boolean not null default false,
  created_by                  uuid references public.volunteers (id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint events_valid_interval check (starts_at < ends_at),
  constraint events_max_length check (ends_at - starts_at <= interval '24 hours'),
  constraint events_coverage_not_self check (coverage_event_id is null or coverage_event_id <> id),
  -- Provider cover and "not required" are admin decisions that must carry a reason and who made them.
  constraint events_external_cover_recorded check (
    site_cover_source = 'club_volunteer'
    or (external_cover_note is not null and char_length(btrim(external_cover_note)) > 0
        and external_cover_verified_by is not null and external_cover_verified_at is not null)
  )
);
create index events_venue_starts_idx on public.events (venue_id, starts_at);
create index events_starts_idx on public.events (starts_at);
create index events_coverage_idx on public.events (coverage_event_id) where coverage_event_id is not null;

create table public.event_shifts (
  id                       uuid primary key default gen_random_uuid(),
  event_id                 uuid not null references public.events (id) on delete restrict,
  duty_type_id             uuid not null references public.duty_types (id) on delete restrict,
  starts_at                timestamptz not null,
  ends_at                  timestamptz not null,
  required_count           integer not null check (required_count between 1 and 50),
  signup_enabled           boolean not null default true,
  approval_required        boolean not null default false,
  instructions             text check (instructions is null or char_length(instructions) <= 2000),
  status                   public.shift_status not null default 'active',
  source_template_item_id  uuid references public.duty_template_items (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint event_shifts_valid_interval check (starts_at < ends_at),
  constraint event_shifts_max_length check (ends_at - starts_at <= interval '24 hours')
);
create index event_shifts_event_starts_idx on public.event_shifts (event_id, starts_at);
create index event_shifts_duty_idx on public.event_shifts (duty_type_id);

create table public.event_shift_responsibilities (
  shift_id      uuid not null references public.event_shifts (id) on delete cascade,
  duty_type_id  uuid not null references public.duty_types (id) on delete restrict,
  primary key (shift_id, duty_type_id)
);

-- ---------------------------------------------------------------------------
-- Assignments & cancellation requests
-- ---------------------------------------------------------------------------
create table public.assignments (
  id                    uuid primary key default gen_random_uuid(),
  shift_id              uuid not null references public.event_shifts (id) on delete restrict,
  volunteer_id          uuid not null references public.volunteers (id) on delete restrict,
  status                public.assignment_status not null,
  source                public.assignment_source not null,
  assigned_by           uuid references public.volunteers (id) on delete set null,
  responded_at          timestamptz,
  status_changed_at     timestamptz not null default now(),
  removal_reason        text check (removal_reason is null or char_length(removal_reason) <= 500),
  attendance_status     public.attendance_status not null default 'not_recorded',
  attendance_marked_by  uuid references public.volunteers (id) on delete set null,
  attendance_marked_at  timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (shift_id, volunteer_id)
);
create index assignments_volunteer_status_idx on public.assignments (volunteer_id, status);
create index assignments_shift_status_idx on public.assignments (shift_id, status);

create table public.cancellation_requests (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments (id) on delete restrict,
  volunteer_id   uuid not null references public.volunteers (id) on delete restrict,
  reason         text check (reason is null or char_length(reason) <= 500),
  status         public.cancellation_request_status not null default 'pending',
  resolved_by    uuid references public.volunteers (id) on delete set null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);
create unique index cancellation_requests_one_pending
  on public.cancellation_requests (assignment_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Notifications, audit, settings
-- ---------------------------------------------------------------------------
create table public.notification_outbox (
  id                      uuid primary key default gen_random_uuid(),
  recipient_volunteer_id  uuid not null references public.volunteers (id) on delete cascade,
  kind                    text not null check (kind ~ '^[a-z_]{3,40}$'),
  entity_type             text not null,
  entity_id               uuid not null,
  dedupe_key              text not null unique,
  payload                 jsonb not null default '{}'::jsonb,
  send_after              timestamptz not null default now(),
  status                  public.notification_status not null default 'pending',
  attempt_count           integer not null default 0,
  sent_at                 timestamptz,
  error                   text,
  created_at              timestamptz not null default now()
);
create index notification_outbox_due_idx on public.notification_outbox (send_after) where status = 'pending';

create table public.audit_log (
  id                  bigint generated always as identity primary key,
  actor_volunteer_id  uuid references public.volunteers (id) on delete set null,
  action              text not null,
  entity_type         text not null,
  entity_id           uuid,
  old_data            jsonb,
  new_data            jsonb,
  created_at          timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at);

create table public.club_settings (
  id                       smallint primary key default 1 check (id = 1),
  withdrawal_cutoff_hours  integer not null default 24 check (withdrawal_cutoff_hours between 0 and 336),
  reminder_day_before      boolean not null default true,
  timezone                 text not null default 'Europe/London',
  updated_at               timestamptz not null default now()
);

-- updated_at maintenance
do $$
declare t text;
begin
  foreach t in array array['venues','teams','duty_types','volunteer_duty_authorisations','duty_templates',
                           'duty_template_items','events','event_shifts','assignments','club_settings']
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;
