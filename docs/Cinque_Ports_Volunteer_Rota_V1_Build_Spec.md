# Cinque Ports FC — Volunteer & Venue Rota
## V1 Product Specification & Claude Code Implementation Plan
**Date:** 16 October 2026  
**Status:** V1 architecture + agreed duty catalogue; template quantities are editable proposed defaults  
**Scope:** Marke Wood and Freemens Way, all club football fixtures and club events.  
**System boundary:** Standalone volunteer app with no direct access to Carl OS. Future integration through a narrow authenticated API.

## A. Business objective & V1 scope

An approved volunteer should be able to use a phone to find a published event, see eligible vacancies, sign up, confirm a directly assigned duty and manage their commitments. A club organiser should be able to see required staffing and reliably identify who has **confirmed** for each venue/time. Do not conflate availability, invitation and confirmation.

### V1 must have
1. Two initial venues: Marke Wood and Freemens Way; add venues through admin settings.
2. Event list and calendar for matches, training, meetings, maintenance, fundraising, other events and venue-only coverage.
3. Team optional for non-fixture events; opponent and competition optional free-text fields in V1.
4. Exactly nine canonical duty types and nine editable venue/event templates (see `Duty_Catalogue_and_Venue_Templates_V1.md`); templates support event-start/event-end time anchors, optional duty toggles, composite responsibilities and shift-specific required headcount.
5. Invitations to approved volunteers, passwordless sign-in, admin/coordinator/volunteer roles, coordinator venue scope.
6. Volunteer self-signup for eligible vacancies; admin/coordinator direct allocation; invitation acceptance/decline; approval where required.
7. Assignment status, strict capacity and overlap checks, cancellations, rescheduling, and attendance marking.
8. Rota dashboard by date and venue with gap metrics and filters for unfilled shifts, missing site leads, pending approvals and unconfirmed invitations.
9. My Duties view with confirmed, invitations and past duties; privacy-conscious event roster.
10. Email notifications for invitations/approvals/changes/cancellations plus configurable reminder (default the day before; use local UK time).
11. Audit logging, basic accessibility, responsive phone-first layout, UK date/time handling.

### Out of scope for V1
Live FA Full-Time sync, club statistics tracker sync, Carl OS integration, WhatsApp APIs, payroll, fundraising, volunteer scoreboards, full safeguarding record management, SMS, native phone apps, complex repeating series, personal availability calendar, booking facilities for external organisations, uploading DBS documents, volunteer-to-volunteer messaging.

## B. Actors and permissions

- **Admin**: whole system, invite/suspend users, venue and template management, authorise coordinators, manage events/shifts/assignments at both venues, attendance, settings and audit.
- **Coordinator**: create/edit/publish events and manage shifts/assignments within explicitly assigned venue(s); view only necessary contact information for volunteers assigned to their venue's events; no user role management or security configuration.
- **Volunteer**: read published event/shift information, self-signup for eligible vacancies, accept/decline their invitations, withdraw within policy, view own duties, see limited on-event names, edit own display name/optional phone; no direct assignment of others.
- **Inactive/pending approval**: cannot access application data; all routes and policies enforce this server-side.
- Duty-specific authorisations (e.g. restricted youth-related role) are independent of the application access role. Only designated authorised club personnel set eligibility, based on their external club/FA process. Do NOT store DBS certificates, certificate numbers, criminal-history details or unnecessary sensitive notes.

## C. Glossary

- **Event**: a fixture, training session, other club activity or umbrella `venue_coverage` session at a particular venue and time.
- **Shift**: a named duty at an event with its own start/end, required headcount and signup rules. Shift times can begin before or end after the event itself.
- **Direct allocation / invitation**: a person nominated by an organiser; status `invited`, NOT a confirmed booking.
- **Self signup**: approved volunteer elects to take an open duty. If approval is not needed, it becomes `confirmed`; otherwise `pending_approval`.
- **Confirmed**: committed volunteer expected at the shift.
- **Attendance**: organiser-recorded `present`/`absent`/`not_recorded` after or during shift. This is different from confirmation.

## D. User workflows and state transitions

### D1 Admin event setup
1. Admin/coordinator creates draft event with venue, optional team, type, title, start/end, optional kickoff, opponent/competition, description and instructions.
2. Select an event template; generate event shifts using each item's start/end offset relative to event starts_at. Or add/edit individual shifts manually.
3. Preview composite/individual shifts and choose which optional duties (e.g. gate or tea bar) are actually operating. Confirm required headcounts, venue-wide coverage source, self signup and approval settings.
4. Validate: venue present, start < end, every shift start < end, headcount >=1; check site responsibility and linked venue coverage when relevant. Publish when required cover is resolved or a specifically authorised, clearly flagged external-coverage decision is recorded.
5. On publishing, eligible volunteers see open roles. Changes create audit events and relevant notifications.

### D2 Volunteer self signup
1. Approved logged-in volunteer opens a published event/shift.
2. Server checks volunteer active, shift active, event published, eligible role and headcount availability.
3. Server checks for overlapping confirmed/pending_approval assignments across ALL venues.
4. Atomically insert/upsert assignment to `confirmed` (open duty) or `pending_approval` (approval-required duty). Show success only after commit.
5. A waiting approval provisionally holds one place; an invitation does not.

### D3 Admin allocation
1. Admin/coordinator chooses a volunteer and shift and clicks Allocate.
2. Server validates venue scope, role eligibility and status.
3. Create/update assignment `invited`, send private invitation email.
4. Volunteer accepts (server checks capacity and conflicts at acceptance) or declines. Declines release opportunity; audit entry retained.
5. If full by time of acceptance, show explicit 'Shift now full; please contact organiser' (do not silently overbook).

### D4 Coordinator approval
1. Volunteer self signs up for shift requiring approval: `pending_approval` with a provisional place.
2. Coordinator sees pending queue. Checks eligibility and staffing.
3. Approve to `confirmed` or reject to `declined`; notify volunteer. Restricted duty eligibility remains a separate prerequisite.

### D5 Withdrawals, changes and cancellations
1. Volunteer may withdraw themselves until the configured cutoff (default **24 hours** ahead of shift; configurable). Inside cutoff: 'Request cancellation' alerts an organiser; it does **not** silently remove cover. Admin/coordinator can remove with a reason at any time.
2. Upon withdrawal/removal, coverage recalculates and the vacancy reopens. An email/alert enters the outbox.
3. Material shift-time/date or venue changes trigger an audit record and reset impacted confirmed/pending/invited assignments to `invited` for renewed confirmation, with any prior provisional slots freed; notify affected people. On subsequent acceptance, re-run approval logic: an approval-required shift moves to `pending_approval`, NEVER straight to `confirmed` unless an authorised organiser has approved the revised commitment. If shifts are newly generated, preserve assignment linkage only where explicitly mapped. Do not delete historical changes.
4. Cancelling an event marks it and its shifts cancelled and active assignments `cancelled`; suppress scheduled reminders, notify affected volunteers, retain history.
5. Past events can be completed and attendance marked individually (`present`, `absent`, `not_recorded`); no user performance scores.

### D6 Site-wide cover and multiple events
- Create an event of type `venue_coverage` for a site's full operations window. The confirmed site-lead shift may include `open_unlock`, `facility_checks`, `lock_secure` as **responsibilities within one assignment**, rather than generating duplicate concurrent vacancies. When different people cover opening/closing, create separate nonoverlapping shifts. See the detailed template guide.
- Events may overlap at the same venue. The rota groups them, rather than assuming one event per day/site.
- Other events may link to a same-venue `venue_coverage` record and suppress duplicate lead/open/lock/check duties only while adequate confirmed lead coverage truly spans the required window. If the lead cancels, moves or becomes ineligible, warn on ALL affected events. Admin-documented verified external facility coverage is visually distinct from volunteer-confirmed coverage.
- Venue-level dashboard shows staffing by **time** and identifies lack of site-lead coverage where required. Avoid claiming that anyone is physically present solely from a confirmation.

### D7 Notification expectations
- Email events: welcome/invite, direct-duty invitation, confirmation, decline/rejection, material change/reconfirm request, withdrawal/cancellation, day-before reminder to confirmed assignees, low-coverage summary to admins/coordinators (optional weekly digest).
- Use an outbox and idempotency keys. Do not send directly in database transactions; write outbox row in same transaction, dispatch via authenticated server worker. Retry failed sends; never include private roster/contact list in emails.

## E. Database model (PostgreSQL / Supabase)

**Conventions:** UUID primary keys; `created_at` and `updated_at` UTC timestamptz where relevant; timestamps stored as `timestamptz`, formatted using `Europe/London`; use `citext` for case-insensitive emails; foreign keys and appropriate indexes. No physical deletion of rota history during normal operations.

| Table | Key fields | Details/constraints |
|---|---|---|
| `venues` | `id`, `name`, `short_name`, `address?`, `active` | Seed Marke Wood, Freemens Way. |
| `teams` | `id`, `name`, `active` | Optional link for an event. |
| `volunteers` | `id`, `auth_user_id?`, `email`, `display_name`, `phone?`, `role`, `is_active`, `invited_at?` | Unique case-insensitive email and unique nullable auth ID; role enum admin/coordinator/volunteer. Pre-create volunteer before Auth user accepts invite. |
| `coordinator_venues` | `volunteer_id`, `venue_id` | Unique pair. Only assigned venue(s) manageable. |
| `duty_types` | `id`, `code`, `name`, `description?`, `requires_authorisation`, `active` | Seed exactly the nine canonical codes from `Duty_Catalogue_and_Venue_Templates_V1.md`; no Parking duty. Do not store DBS data. |
| `volunteer_duty_authorisations` | `volunteer_id`, `duty_type_id`, `approved_by`, `approved_at`, `valid_until?`, `active` | Restricted type can only be performed while active and not expired. Kept private; qualified personnel manage this out of band or admins after verification. |
| `duty_templates` | `id`, `name`, `event_type`, `venue_id?`, `active` | Templates may be global or venue-specific. |
| `duty_template_items` | `id`, `template_id`, `duty_type_id`, `start_anchor`, `start_offset_minutes`, `end_anchor`, `end_offset_minutes`, `required_count`, `enabled_by_default`, `when_to_enable?`, `signup_enabled`, `approval_required` | Anchors: `event_start` or `event_end`. Optional items disabled by default are not generated until enabled. |
| `template_item_responsibilities` | `template_item_id`, `duty_type_id` | Extra duties within a **single primary template shift**; unique pair, not separately staffed. |
| `events` | `id`, `venue_id`, `team_id?`, `coverage_event_id?`, `title`, `event_type`, `starts_at`, `ends_at`, `kickoff_at?`, `opponent?`, `competition?`, `description?`, `status`, `site_cover_source`, `external_cover_note?`, `external_cover_verified_by?`, `created_by` | Coverage event points to same-venue `venue_coverage` event and is validated by time/confirmed shift, not by FK alone. `site_cover_source`: `club_volunteer | provider_verified | not_required`, the last 2 require admin reason when applicable. |
| `event_shifts` | `id`, `event_id`, `duty_type_id`, `starts_at`, `ends_at`, `required_count`, `signup_enabled`, `approval_required`, `instructions?`, `status` | Status active/cancelled; specific times, can cross midnight; may precede event start. Primary staffed role only. |
| `event_shift_responsibilities` | `shift_id`, `duty_type_id` | Included secondary duties shown in UI; no independent headcount or vacancy. |
| `assignments` | `id`, `shift_id`, `volunteer_id`, `status`, `source`, `assigned_by?`, `responded_at?`, `attendance_status`, `attendance_marked_by?`, `attendance_marked_at?` | Unique `(shift_id, volunteer_id)`, upsert for re-invitations; no duplicate active assignment. |
| `cancellation_requests` | `id`, `assignment_id`, `volunteer_id`, `reason?`, `status`, `resolved_by?`, `resolved_at?` | Late cancellations remain pending until organiser acts. |
| `notification_outbox` | `id`, `recipient_volunteer_id`, `kind`, `entity_type`, `entity_id`, `dedupe_key`, `payload`, `send_after`, `status`, `attempt_count`, `sent_at?`, `error?` | Unique dedupe key; background worker processes due messages. |
| `audit_log` | `id`, `actor_volunteer_id?`, `action`, `entity_type`, `entity_id`, `old_data?`, `new_data?`, `created_at` | Read only for authorised organisers; redact PII and avoid sensitive documents. |
| `club_settings` | `id`, `withdrawal_cutoff_hours`, `reminder_day_before`, `timezone` | Single club row for V1. Defaults 24, true, Europe/London. |

### Enumerations
- `event_type`: `fixture | training | meeting | maintenance | fundraising | club_event | venue_coverage | other`
- `event_status`: `draft | published | postponed | cancelled | completed`
- `assignment_status`: `invited | pending_approval | confirmed | declined | withdrawn | removed | cancelled`
- `assignment_source`: `self_signup | admin_allocation`
- `attendance_status`: `not_recorded | present | absent`
- `notification_status`: `pending | sending | sent | failed`
- `template_time_anchor`: `event_start | event_end`
- `site_cover_source`: `club_volunteer | provider_verified | not_required`

### Data integrity and concurrency
- FK references and unique `(shift_id,volunteer_id)` prevent duplicate records; indexes on events `(venue_id, starts_at)`, shifts `(event_id,starts_at)`, assignments `(volunteer_id,status)` and `(shift_id,status)`.
- **Confirmed coverage = count of `confirmed` assignments**, not invitations. Additional included responsibilities on composite shifts NEVER add extra headcount. Display `pending_approval` separately. `open_slots = max(0, required_count - confirmed_count - pending_approval_count)`. Pending approval provisionally occupies one vacancy; invitations reserve none.
- Every `self_signup`, `accept_invitation`, `approve_assignment`, `withdraw`, `cancel_event`, `reschedule_event` and `update_shift` mutation MUST run as an atomic transaction, preferably through narrowly scoped Postgres RPC functions or an equivalent transaction-capable trusted backend.
- For cross-shift concurrency: lock volunteer row first, shift row second, then re-check role eligibility, permission, capacity, and overlaps **inside the same transaction** before assigning/confirming. Lock ordering must be consistent. Overlap condition: `existing_start < requested_end AND requested_start < existing_end`, only `confirmed` and `pending_approval` reservations block. Ignore cancelled events/shifts. This also guards same-venue clashes; authorised exceptions should be modelled as separate nonoverlapping/composite duties in V1, not silent overrides.
- Assignment state changes validated by central transition functions. Never allow arbitrary client-side updates to `status`, `role`, `attendance`, `authorisation`, or event ownership.
- DB `CHECK` constraints enforce valid intervals and positive staffing count. Use migration-managed constraints, not UI-only validation.
- Validate coverage links (`events.coverage_event_id`) server-side and in database constraints/triggers: only a different `venue_coverage` event at the same venue, never a link cycle; site coverage must be computed from confirmed, authorised lead shift intervals for the relevant window. Re-evaluate warnings after cancellation, reconfirmation, eligibility change and time edits.
- Template application must be idempotent within a single edit operation, preserving existing assignments on routine edits; changing to a different template needs preview/mapping, not silent deletion of historical shifts.

## F. Security and safeguarding boundaries

1. Use current supported Next.js App Router and Supabase Auth SSR patterns. Use `@supabase/ssr` cookie sessions and verify server-side identity. Never trust the client-side role label.
2. Invite-only: admin creates/sends Auth invite; link `auth_user_id` to an active `volunteers` row after email verification through a trusted callback using verified Auth email and a matching admin-created invitation; never accept user-supplied volunteer IDs for account linking. Normal sign-in uses email OTP with `shouldCreateUser:false`; uninvited users cannot auto-create accounts.
3. Enable RLS on **all** application tables. `anon` reads none. Volunteers can read published events/shifts, their own assignment rows/profile and safe roster names through a dedicated sanitised endpoint/function. Coordinators see/edit venue-scoped resources only. Admins have club-wide scope. No general client access to `volunteers.email`, phone, authorisations or audit data.
4. All mutation Server Actions/Route Handlers check session, active status, object-level venue permission and duty-level eligibility; UI hiding controls is not security. RLS is an additional barrier. Do not expose Supabase service-role key to browser. Normal reads/writes should use user-scoped RLS; if elevated server procedures are needed, keep operations narrow, explicit, validated and audited.
5. Readable roster names to volunteers on the *same published event* only; never expose other volunteers' emails or phone numbers. Volunteer-facing views cannot reveal private records of other individuals.
6. For roles involving young people, a designated official must establish current external eligibility under FA rules. Record only minimal authorisation status and expiry, NOT DBS certificate data. The rota is not the safeguarding source of truth.
7. Keep all data in the club's own Supabase project, not Carl OS's database. Agree privacy notice, retention policy, who can see data, access review and deletion/anonymisation process before launch.
8. Escape user-supplied strings; validate all inputs; secure cron endpoints and email sender credentials; rate-limit login and signup writes; CSRF protections per current Next.js/Supabase guidance; structured server error logs without leaking personal data.

## G. Screens and routes

**Public/Auth**
- `/login`: Cinque Ports FC branding; enter email; explanation of invitation-only access; sign in by emailed code/link; generic response to unknown addresses.
- `/auth/callback`: secure auth completion and approved-volunteer link/activation.

**Volunteer** (bottom navigation: Rota | My Duties | Profile)
- `/rota`: upcoming events grouped by date; venue tabs, team/type filters; coverage labels, suitable vacancies, sign-up actions; week/list views first.
- `/rota/[eventId]`: title, venue, start/end, kickoff if fixture; duty shift cards showing start/end, confirmed/required headcount, eligibility, button Sign Up or Request Approval; safe names only if authorised.
- `/my-duties`: tabs Confirmed, Awaiting response, Pending approval, Past; accept, decline, withdraw/request cancellation; add-to-calendar `.ics` for own confirmed shift if quick to implement.
- `/profile`: own name, optional contact number, venue preference (optional), sign out and privacy information.

**Admin/Coordinator** (desktop sidebar, responsive menu)
- `/manage`: today's/next 7 days event counts, vacancies, pending approvals, unanswered invitations, events missing site lead, venue filters.
- `/manage/calendar`: week/list by venue and type; events can overlap; clear time-zone representation.
- `/manage/events/new` and `/manage/events/[id]`: draft/edit/publish, shift builder, template select, staffing grid, assign volunteer, notifications, postpone/cancel, complete/attendance and history.
- `/manage/coverage`: filter uncovered shifts by venue, date, team, duty type; quick assign workflow and export/print one-page daily rota.
- `/manage/volunteers`: admins invite/suspend/change access role, set coordinator venues; authorised organisers see only necessary venue-scoped records.
- `/manage/templates`: admins manage reusable standard-duty templates and duty types, including optional toggles, timing anchors and included responsibilities.
- `/manage/coverage`: additionally show linked venue-wide cover, missing lead-time intervals and external provider/club source distinctly; prevent falsely green coverage from a link to an unconfirmed duty.
- `/manage/settings`: admin-only venue/team setup, shift cutoff/reminders, access and data policies.

### Dashboard definitions
- `Confirmed`: number of distinct confirmed assignments relative to role-specific required slots. Count headcounts, not duty lines.
- `Unfilled`: `max(0, required - confirmed - pending_approval)`; also show pending approval number distinctly.
- `Awaiting confirmation`: active `invited` assignment count. Invitations do not fill confirmed staffing.
- `Missing site lead`: event/venue coverage block requiring site lead with no confirmed eligible site-lead assignment. This is a warning, not proof a site is unattended.
- `Expected on-site`: roster of confirmed volunteers whose shift covers the selected point in time; label "expected" rather than "present". Only show actual `present` after attendance has been marked.

## H. Initial seed content (examples, not real fixtures)

**Authoritative catalogue:** Read `Duty_Catalogue_and_Venue_Templates_V1.md` in full. Seed its precise stable codes, nine display names, required authorisation defaults, nine editable templates T01–T09, optional duty states, responsibility bundles, staffing numbers and offsets. Do not infer missing data or add a Parking duty.

- Venues: Marke Wood; Freemens Way.
- Nine duty types: `site_lead`, `open_unlock`, `lock_secure`, `gate_admissions`, `refreshments`, `pitch_setup`, `facility_checks`, `cleaning`, `general_support`.
- Templates: T01 Marke Wood First Team; T02 Marke Wood other adult home fixture; T03 Freemens Way youth fixture block; T04 Freemens Way adult fixture; T05 Training; T06 Multi-fixture day/shared venue operations; T07 Club/community/fundraising; T08 Maintenance/work party; T09 Venue opening/closing.
- Teams are editable through admin UI. Seeded demo fixtures must say `DEMO` and can NEVER trigger real email; import actual fixtures only on organiser verification.
- Seed SQL must be idempotent and identify codes by stable unique values, not display labels. Template staffing numbers are sensible **suggestions** which administrators may adjust for local operations, risk assessment and availability.

## I. Test scenarios & release gates

**Function:** create event, apply template start/end anchors and offsets; optional roles disabled by default; composite duties; same-venue linked coverage and loss-of-cover warnings; publish, eligible self-signup, restricted pending approval, invite/accept/decline, late cancellation request, reassign, dashboard exact counts, complete event/attendance.

**Race/concurrency:** two people claim the final spot simultaneously -> exactly one succeeds; same person accepts overlapping shifts from two tabs -> one succeeds; admin changes capacity during signup -> no overbooking.

**Date/time:** DST start and end in Europe/London, cross-midnight shifts, Saturday event with overlapping Sunday youth fixtures, events at both venues simultaneously; reminder uses correct UK local date.

**Security:** unknown/uninvited address cannot sign up; suspended volunteer cannot read old rota; volunteers cannot query others' contact details; no direct role elevation; venue A coordinator cannot mutate venue B events; expired authorisation cannot fulfil restricted duty; forged server action and unauthorised RPC call both fail.

**Event integrity:** no duplicate site leads for linked fixture blocks; split keyholder handover remains covered; cancelling the linked venue lead warns all dependent fixtures; postponing invalidates confirmation and emails affected volunteers; cancellation suppresses reminder; confirmation email not duplicated by retry; deleted template never deletes historic shifts; no accidental real emails from demo data.

**Usability:** user signs in and volunteers on a phone in under 1 minute; labels and errors understandable to nontechnical members; readable without colour cues; keyboard navigation; loading and empty states; no horizontal scroll at 375px width; print daily rota cleanly.

**Quality gates:** TypeScript typecheck, linter, automated tests, SQL migrations repeatably apply and roll back safely where appropriate, RLS allow/deny tests, production preview review, security/privacy sign-off, pilot group acceptance.

## J. Deployment and ongoing operations

- Separate Git repository and separate Supabase project. Use Vercel staging + production environments. Only production domain is allowed as a redirect; staging uses dedicated config. Never store secrets in git.
- Email provider with verified club-owned sending domain; Supabase SMTP for Auth messages and a trusted server-only transactional provider for app alerts, or a carefully configured single provider.
- Secure scheduled worker to drain outbox; retries with exponential backoff and a unique dedupe key; make manual retry visible to admin. Daily reminders should use local `Europe/London` scheduling logic even if worker triggers in UTC.
- Have admin recovery path, second administrator, backups, privacy notice, account disable procedure, monitoring, basic uptime and error logs.
- After launch, trial 2 weeks using real club rota in parallel with existing practice; then make the portal the authoritative schedule, with WhatsApp used for linking/reminding rather than maintaining a conflicting second rota.

## K. Claude Code implementation phases

**0 — Repo/plan:** Inspect project; produce implementation architecture and assumptions. Confirm no touch to Carl OS. Create README, `.env.example`, `docs/decisions.md`, `docs/acceptance-tests.md` and task checklist. No code until architecture reviewed.

**1 — Foundation/auth:** Initialise TypeScript Next.js App Router, Tailwind CSS and accessible UI components. Connect Supabase SSR. Implement invite-only Auth and profiles. Add active-account and role-based route guards. Document environment variables.

**2 — Database/permissions:** Write numbered migration files defining tables/types/indexes/checks, RLS policies, indexes and atomic assignment operations. Seed venue/duty data. Write automated database/RLS tests before UI mutations.

**3 — Admin events/templates:** Seed the exact nine duty types and T01–T09 editable templates from the catalogue file, including start/end anchors, default-disabled optional roles, composite responsibilities and venue coverage links. Create venues/teams, event create/edit/publish, shift generation, list/week view, overlapping events and draft validation.

**4 — Volunteer experience:** Rota browse/filter, event duty details, My Duties, self-signup/request approval, accept/decline invitation, withdrawal cutoff and late-cancellation request, own profile. Integrate exact status/count calculations.

**5 — Admin allocation/coverage:** Coordinator scope, volunteer picker, invite/approve/reject/manage shifts; venue dashboard, staffing gaps, printable daily view, attendance, postpone/cancel with reconfirmation.

**6 — Alerts/polish:** Transactional outbox, email templates, secure dispatch/reminder worker, resilience, time-zone and accessibility QA.

**7 — Production pilot:** Create staging and production, environment secrets, test volunteers, demo-data guard, permissions/security audit, pilots, backups and handover. Complete acceptance suite and document how admins use it.

### Standard protocol for EVERY phase
1. Explain which files/tables change and why.
2. Work only on this phase; minimise dependencies and scope.
3. Add tests for the new business rules and security boundaries.
4. Run install, lint, typecheck and applicable tests; report actual results.
5. Show a user-facing demo of the phase and identify open issues before moving on.
6. Create a clear git commit for the completed phase; don't deploy without an explicit instruction.

## L. V1 success criteria

- An organiser can enter an event and build its staffing template in no more than a few minutes.
- A volunteer can sign in and confirm an eligible open duty from their phone.
- Admin can view a trustworthy day/week coverage summary for both venues in seconds.
- Confirmed-only count, provisional and invited states are separate and accurate.
- No overbooking or conflicting confirmed volunteer shifts, including under concurrent signups.
- Role/privacy/venue boundaries verified by negative tests.
- A postponed/cancelled fixture correctly handles assignments and alerts.
- Someone other than the original builder can administer the system using its built-in guides.

## M. Authoritative implementation references

- Supabase Next.js Auth quickstart: https://supabase.com/docs/guides/auth/quickstarts/nextjs
- Supabase Auth passwordless: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase SSR: https://supabase.com/docs/guides/auth/server-side
- Next.js Auth guide: https://nextjs.org/docs/app/guides/authentication
- Next.js mutation/security guidance: https://nextjs.org/docs/app/getting-started/mutating-data
- FA safer recruitment: https://www.thefa.com/football-rules-governance/safeguarding/section-3-safer-recruitment-and-dbs-checks
- ICO data minimisation: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/
