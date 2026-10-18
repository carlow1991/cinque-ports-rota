# 02 — Database, API, States, Permissions & Migration

## 0. Architecture strategy
Inspect the real repository first. Reuse installed, compatible Next.js/TypeScript and Supabase stack if present. Do **not** replace working auth, create new Supabase projects for production, or change architectural framework just to follow this reference. If stack differs, map these logical entities to existing conventions. SQL below is a **model contract**, not a ready-to-run production migration.

Recommended boundary: Next.js App Router + server-side domain services + Supabase Auth/Postgres + RLS; server mutations validated with Zod or equivalent; typed data layer; transactional email outbox; UTC `timestamptz` with Europe/London presentation; no direct client mutation bypassing permission services.

## 1. Logical tables (adapt names if legacy tables exist)
All tables: stable UUID primary key; created_at, updated_at; creator/actor attribution where meaningful. FK/index for all joins; unique and check constraints. Never store secrets in browser code.

### Club structure / identity
**`people`**: id, full_name (required), display_name, email_normalized (nullable), phone_normalized (nullable), preferred_contact_channel (nullable), lifecycle_status (`active`, `applicant`, `inactive`), portal_invite_status (`not_invited`, `invited`, `active`, `disabled`), routine_requests_enabled boolean default false, directory_visibility (`private`, `members`, `public_contact`), contact_visibility flags, notes_private, created_at, updated_at. Do not require email for person record.

**`user_accounts`**: person_id unique FK, auth_user_id unique FK to auth principal (implementation-specific), access_level (`admin`, `coordinator`, `member`), enabled boolean, linked_at. An unlinked person may never authenticate merely because an email exists. Separate account identity and operational person record.

**`teams`**: id, name, active, optional type; seed First Team, Reserves, Ladies, Veterans, Mini Kickers, Youth programme; exact active teams to be verified against real data rather than duplicating records.

**`team_people`**: id, team_id, person_id, role_label (`Manager`, `Coach`, etc. free text), is_expected_by_default boolean, active_from, active_to nullable; composite/index by team and time. A person can manage several teams. Do not auto-assign unverified names.

**`venues`**: id, name, active boolean, location_text, optional directions; Marke Wood active, Freemens Way inactive. `active=false` must not delete events or references.

### Calendar & volunteer involvement
**`events`**: id, title, category, team_id nullable, venue_id nullable, external_location_text nullable, begins_at timestamptz, ends_at nullable timestamptz, kickoff_at nullable timestamptz, volunteers_enabled boolean default false, status (`draft`,`published`,`cancelled`,`completed`), visibility (`members`,`public_if_explicit`), notes, organiser_person_id nullable, created_by, last_changed_by. Constraint: either venue or external location (where applicable), ends_at > begins_at when set. Treat begins_at as event scheduling anchor, not automatically pitch prep/café start time. Information-only events have volunteers_enabled=false.

**`availability_requests`**: id, event_id, person_id, requested_by_person_id, sent_at nullable, delivery_state (`not_sent`,`queued`,`sent`,`failed`,`manual_contact`), requested_at; unique(event_id, person_id) for current request. A person isn't 'Not replied' without a request.

**`event_availability`**: id, event_id, person_id, response (`yes`,`no`), available_from nullable timestamptz, available_until nullable timestamptz, for_full_event boolean, response_source (`self`,`admin_recorded`), recorded_by_person_id nullable, responded_at, updated_at; unique(event_id, person_id). `yes && for_full_event` requires known end for full claimed window; if event end unknown, use 'available time unspecified' until confirmed. For `no`, clear interval. For partial `yes`, validate bounded range and event alignment, or surface exception to admin if no end is known. Changes append to audit/event history.

**`assignments`** (single table for event-specific and venue-wide coverage): id, person_id, scope (`event`,`venue`), event_id nullable, venue_id nullable, responsibility_label nullable, begins_at, ends_at, state (`pending`,`confirmed`,`declined`,`cancelled`,`needs_reconfirmation`), invitation_source (`portal`,`email`,`offline`), response_source (`self`,`admin_recorded`,null), recorded_by_person_id nullable, requested_by_person_id, responded_at nullable, notes_private nullable; exactly one of event_id or venue_id required based on scope. Event assignment's time is independent but relevant to event; venue cover may span multiple concurrent events. Preserve history on state changes and event postponements. No mandatory duty catalog FK.

**`event_participation_exceptions`**: event_id, person_id, team_person_id nullable, override (`not_expected`,`confirmed_by_person`,`confirmed_by_admin`), recorded_by, note, created_at; used only to override default inferred manager expectation per event, not to edit permanent team memberships.

**`volunteer_preferences`**: person_id unique, preferred_commitment_bucket, commitment_pattern (`regular`,`occasional`,`one_off`,`unsure`), location_preference (`onsite`,`remote`,`either`), willing_to_learn boolean nullable, strengths jsonb/string codes, interests jsonb/string codes, free_text_optional, last_updated_at. Keep flexible and minimal; normalized join tables are fine if existing app patterns support them.

**`usual_availability`**: id, person_id, day_of_week (0-6, documented convention), daypart (`morning`,`afternoon`,`evening`) OR exact optional time; unique(person_id, day_of_week, daypart). This is a preference, **not** event RSVP.

### Club roles & recruitment
**`club_positions`**: id, title, department, public_summary, responsibilities, estimated_commitment, work_location_preference, skills_required, skills_desirable, training_available boolean, requires_external_safeguarding_review boolean, public_visible boolean, recruiting_contact_person_id nullable, active boolean, `seeking_replacement` boolean default false, `seeking_additional_help` boolean default false, `publish_vacancy` boolean default false. Occupancy is **derived**, not encoded as one mutually exclusive status. An occupied position may have both recruitment flags true.

**`position_holders`**: id, club_position_id, person_id, start_date, end_date nullable, capacity_label (`holder`,`joint`,`acting`,`support`), note_private, created_at. A person can hold many posts; one post can have many active holders. End date records historical handover. Do not silently close historical records.

**`position_interests`**: id, person_id nullable, application_id nullable, position_id, stage (`interested`,`contacted`,`discussion`,`shadowing`,`handover`,`appointed`,`withdrawn`,`closed`), created_at, updated_at, note_private. An appointment is an internal workflow record and **not** automatic formal club/FA registration.

### Public applications
**`volunteer_applications`**: id, linked_person_id nullable, full_name, email_normalized nullable, phone_normalized nullable, contact_preference, existing_club_connection nullable, source_nullable, interests array/jsonb, selected_position_ids array or join relation, unsure_role boolean, strengths array/jsonb, experience_text nullable, willing_to_learn nullable, availability jsonb (or join), commitment_bucket, commitment_pattern, work_location_preference, free_notes nullable, privacy_notice_version, privacy_acknowledged_at, communication_opt_in optional with timestamp, stage (`new`,`reviewing`,`contacted`,`trial`,`accepted_to_pool`,`closed`), duplicate_review_status, assigned_reviewer_id nullable, last_contacted_at nullable, follow_up_on nullable, created_at, retention_review_at. Private by default. Linking a person happens after explicit admin review; application may appear under `People > Applicants` without login.

**`application_role_suggestions`**: application_id, club_position_id, score optional, reasons jsonb, computed_at; explanatory suggestions only (cannot appoint or screen out a person automatically).

### Operations
**`notification_outbox`**: id, type, recipient_person_id or safe email recipient, related_entity_type/id, payload_json, idempotency_key unique, status (`queued`,`sent`,`failed`,`suppressed`), attempts, next_attempt_at, provider_message_id nullable, last_error_private; write after approved action, dispatch async server-side.

**`audit_log`**: id, actor_person_id nullable, action, entity_type, entity_id, before_json redacted, after_json redacted, source, occurred_at; protect from ordinary user access. Do not log sensitive public application responses in plaintext request logs.

**`app_settings`**: privacy_notice_version, contact_email, retention policy values, email sender configured status, feature toggles as needed; do not store secrets in settings.

## 2. Derived views: avoid duplicated data
- **`current_position_occupancy`**: count active postholders as of requested date; show vacant / held / shared + independent recruitment flags.
- **`venue_cover_for_event`**: where event.venue_id = assignment.venue_id AND assignment.state = confirmed AND assignment.begins_at < event.ends_at AND assignment.ends_at > event.begins_at. If event.ends_at missing, do not assert overlap/full-event coverage without safe anchor; show possible venue cover at scheduled start only, labelled uncertain.
- **`expected_team_people`**: active team_people entries for event.team_id with is_expected_by_default; apply event participation exceptions. NEVER count as confirmed without explicit response.
- **`day_people_summary`**: de-duplicate person IDs across concurrent events and shared venue shifts to avoid inflated people counts.

## 3. Core server operations (all authorised)
- `createPerson`, `updatePerson`, `linkPersonAccount`, `inviteToPortal` (explicit separate action)
- `createEvent`, `updateEvent`, `publishEvent`, `cancelEvent`, `duplicateEvent`
- `requestAvailability(eventId, personIds, send=true)` explicit confirmation, `respondToAvailability`, `recordAvailabilityOffline`
- `createAssignment`, `acceptAssignment`, `declineAssignment`, `cancelAssignment`, `recordOfflineConfirmation`
- `listEventsWithVenueCover`, `listExpectedTeamOfficials`
- `createClubPosition`, `updateRecruitingFlags`, `setPositionHolders`, `recordSuccessionInterest`
- `submitPublicVolunteerApplication` (no auth, heavy rate limiting & input sanitisation), `reviewApplication`, `linkApplicationToPerson`, `suggestRoleMatches`
- `enqueueNotification` / `dispatchOutbox` in secured server environment only

Idempotency: requesting same person/event twice should not duplicate requests or messages; accepting a request twice remains confirmed once; simultaneous admin edits should avoid lost updates (optimistic version or DB transaction). Validate all FKs and tenant/application boundaries.

## 4. State machines
**Availability**: no request; requested/not replied; yes with full/partial time; no. Reply is independent of assignment. A reply may be revised; retain audit.
**Assignment**: pending -> confirmed | declined | cancelled. Confirmed -> needs_reconfirmation when material schedule change -> confirmed/declined/cancelled. Cancelled terminal for that record; create new assignment if required.
**Person**: applicant -> active/inactive, independent `user_accounts` linkage and `routine_requests_enabled`.
**Application**: new -> reviewing/contacted/trial/accepted_to_pool/closed, with reopen from closed by admin. Record follow-up dates.
**Club position**: occupancy derived from holders; recruiting flags independent. A filled post may advertise replacement and additional help simultaneously.

## 5. Permissions matrix (implement in server code AND RLS)
| Entity | Public | Member | Coordinator | Admin |
|---|---|---|---|---|
| Published public opportunities | Read published only | Read | Read | CRUD |
| Public applications | Create through server-only anti-spam endpoint; no reading | None except their own if product supports | Read scoped only if authorised | Read/manage |
| People contact fields | No | Self only; deliberately published club contacts separately | Minimum relevant scope | Manage |
| Published internal events | No by default | Read | Read/manage scope | CRUD |
| Event availability | No | Read/write own | Read/manage scoped | Read/manage |
| Assignments | No | Read/respond own | Read/manage scoped | Read/manage |
| Shared venue cover | No | Read relevant limited details | Read/manage venue scope | Read/manage |
| Account invitations/permissions | No | None | None | Manage |
| Internal notes, audit | No | No | Only own allowed operational scope where needed | Scoped admin only |

Use Supabase RLS for exposed schemas: deny by default; create explicit read/write policies. For public applications, preferred route is a dedicated server endpoint with rate limiting/bot verification, strict validation and service credentials kept server-side; do not open public SELECT/UPDATE on applications. Check authorisation again in each server action / route handler. Protect against IDOR by testing cross-person and cross-venue access. Use non-guessable identifiers but do not rely on obscurity. Never expose a service-role key in `NEXT_PUBLIC_*` values.

## 6. Public privacy & retention
- Privacy information must explicitly cover storing and matching applications, contact follow-ups, retention, correction/deletion requests and sharing limits. Use club-approved policy and review against ICO guidance.
- Secure applicant data before club approves them; they are **not** members of the logged-in system.
- Exclude unrestricted public uploads; do not store DBS/check certificates, date of birth, criminal history, medical details or sensitive eligibility status. Restrict youth-related opportunities pending human safeguarding clearance under FA process.
- Spam: hidden honeypot, IP/identifier rate limits, CAPTCHA/Turnstile only if necessary, per-field limits, server validation, dedupe-on-review, CSRF protection as relevant to existing framework, generic submission success response.
- Configure application purge/review schedule with the club and legal advice. Do not invent a mandatory UK retention duration.
- Opt-in to ongoing marketing/news must be separate and optional; operational follow-up for the submitted application has its own privacy explanation.

## 7. Suggested code organisation (adapt to repo)
```
app/(public)/volunteer/page.tsx
app/(public)/volunteer/apply/page.tsx
app/(public)/privacy/page.tsx
app/(auth)/login/page.tsx
app/(hub)/home/page.tsx
app/(hub)/calendar/page.tsx
app/(hub)/calendar/[id]/page.tsx
app/(hub)/people/page.tsx
app/(hub)/people/[id]/page.tsx
app/(hub)/opportunities/page.tsx
app/(hub)/my-profile/page.tsx
app/(hub)/manage/page.tsx
app/(hub)/manage/events/page.tsx
app/(hub)/manage/people/page.tsx
app/(hub)/manage/venue-cover/page.tsx
app/(hub)/manage/club-roles/page.tsx
app/(hub)/manage/applications/page.tsx
app/api/public/volunteer-applications/route.ts
features/people/ ...
features/events/ ...
features/availability/ ...
features/assignments/ ...
features/positions/ ...
features/applications/ ...
lib/auth/ ...
lib/permissions/ ...
lib/db/ ...
lib/notifications/ ...
supabase/migrations/ ...
tests/... 
```
Avoid over-layering the codebase just to match folders above. Ensure imports reflect actual framework conventions.

## 8. Safe migration from original rota
1. Inventory current tables/row counts/FKs/RLS/policies; record auth and notification flows. Run schema dump and create tested backup/rollback before changes. No production write.
2. Create compatibility mapping old `volunteers` to `people` and optional `user_accounts`; preserve legacy UUIDs or mapping table. Prevent duplicate creation with a reviewed mapping by email/phone/name, never automated name-only merge.
3. Map legacy fixtures to events and venue references; identify exact timezone semantics before converting timestamps. Maintain stable IDs/links and history.
4. Convert old shifts/assignments to new `assignments` only where semantics and confirmation evidence are clear. Distinguish volunteer confirmation from mere scheduling. Unclear records flagged for review, not silently 'confirmed'.
5. Retire compulsory duty template UI using feature flag/new routes; old tables remain read-only for historical integrity until explicitly approved for retirement.
6. Add club position, recruitment and public application tables as additive migration; default access private and notifications off.
7. Execute migration on staging data, record counts/checksums/pre/post comparisons, test RLS and external notifications off.
8. Publish only after owner signs off and a tested rollback/feature flag exists. Never drop tables or delete volunteer/history records as part of V1 launch.

## 9. Technical quality gates
Lint, TypeScript typecheck, unit tests for all state transitions, DB integration tests for RLS/scoping/uniques, browser tests for core flows and accessibility, build, seed/staging exercise including DST and overlapping coverage. Protect critical mutations with transactions. Include an environment example but not credentials in repo. Document operational monitoring/notification errors.
