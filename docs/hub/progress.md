# Volunteer Hub — build progress

Branch `hub/volunteer-hub`. Nothing here has been applied to the live Supabase project, deployed, or sent.
Each stage: migration (+ rollback in `docs/sql/`), DB tests on a throwaway Postgres, unit tests, and an
end-to-end check against the production build with a test-only fake Supabase (`tests/e2e/run.sh`).

## Stage 0 — Audit ✅
See `stage-0-audit.md`.

## Stage 1 — People, portal accounts, teams, expected officials ✅
**Migration** `20261019000100_hub_people.sql` (rollback `docs/sql/rollback-20261019000100.sql`, tested).
- New: `people`, `user_accounts`, `coordinator_scopes`, `team_people`, `volunteer_preferences`, `usual_availability`; `audit_log.actor_person_id/source`.
- Every legacy volunteer copied into `people` with the same id; invited/linked ones get a `user_accounts` row with the same Auth link; coordinator venues copied to scopes.
- Sign-in now uses `link_person_account()` (verified email + an explicit invitation; already-linked accounts carry straight over).
- All writes through checked functions; members can read only their own rows; directory via `hub_directory()` (contacts only where shared; under-18s never listed).
**Screens** Hub shell (Home · Calendar · People · Roles · Me, plus Manage for organisers); `/people`, `/my-profile`, `/home` (placeholder until Stage 3); `/manage/people`, `/manage/people/new`, `/manage/people/[id]`; Settings now Hub-admin.
**Retired** old volunteer and organiser URLs redirect to Hub equivalents unless `LEGACY_ROTA_UI=true`.
**Tests** `npm test` 454 passed (incl. `tests/db/hub-people.db.test.ts` 25: C01, C02, C03, C04, C05 part, H06, H07, C51 part, rollback); `tests/e2e/hub-stage1.mts` 22/22.
**Decided** Only administrators create/edit people and send invitations; coordinators see the directory with contacts. Under-18s can't be invited in V1. An invite within 2 minutes of a successful one isn't re-sent.

## Stage 2 — Unified calendar and minimal Create Event ✅
**Migration** `20261019000200_hub_calendar.sql` (rollback tested; it refuses to run while events rely on the new freedoms rather than delete data).
- `events` extended in place (ids kept): optional venue **or** free-text outside/away location; finish time optional (kick-off only); `category`, `volunteers_enabled` (default off), `visibility`, organiser, cancel reason.
- Freemens Way set **inactive**: kept, its events viewable and editable in place, refused for new events.
- `hub_create_event` / `hub_update_event` (reports a material date/time/place change) / `hub_set_event_status` (publish, unpublish, cancel with reason, complete). Nothing sends; publishing only controls visibility.
**Screens** `/calendar` (agenda grouped by day and place, filters, “help wanted” vs “for information”), `/calendar/[id]`, `/manage/events`, `/manage/events/new` (5 fields + one switch, “More options”), `/manage/events/[id]` (edit, publish, cancel, copy to a date as a new draft). The template-driven builder and shift editor are gone from these routes.
**Tests** `tests/db/hub-calendar.db.test.ts` (C08–C12, C14 history, scope, C51 part, rollback), `tests/unit/hub-calendar.test.ts` (C12 labels, H15 DST, H13 copy), `tests/e2e/hub-stage2.mts` 18/18.
**Decided** Copies keep UK wall-clock times (09:00 stays 09:00 across a clock change). The autumn repeated hour uses the first (BST) occurrence. Coordinators can add events at their venues or for their teams.

## Stage 3 — Availability, requests and direct invitations ✅
**Migration** `20261019000300_hub_availability.sql` (rollback tested; export commitments first).
- `availability_requests` (who was deliberately asked), `event_availability` (one current Yes/No per person per event; whole event or a window; changes audited), `hub_assignments` (event **or** venue scope; pending → confirmed/declined/cancelled; needs_reconfirmation after a material change), `event_participation_exceptions` (one-event override of “expected by role”).
- Confirmations must say who confirmed (`self` or `admin_recorded` + organiser) — enforced by constraints.
- Double clicks can't duplicate requests or invitations (unique indexes + idempotent functions).
- Expected by role is derived from team roles (with effective dates) — never stored as confirmed; per-event absence override.
- Material change → confirmed people flagged to reconfirm; cancelled event → open requests closed, history kept.
- `_hub_notify()` hook is a no-op until Stage 7 (nothing is emailed yet; members see requests on Home).
**Screens** Event page: “Can you help?” (Yes → whole event / part → Send), my invitation (Accept / Decline / withdraw), sections Confirmed · Venue-wide cover · Expected by role · Available · (organisers) Awaiting · Declined — one card per person; organiser panels: Request availability (pre-ticked suggestions, explicit Send), Invite a person (request or record offline yes), Record availability. Member Home; `/manage/requests`.
**Tests** `tests/db/hub-availability.db.test.ts` 28 (C14, C16–C24, H25, IDOR, rollback), `tests/unit/involvement.test.ts` (C47 card logic), `tests/e2e/hub-stage3.mts` 19/19.
**Decided** Any signed-in member may offer availability on a help-wanted event; only people asked can be “Not replied”. Partial times on an event with no recorded finish are kept and flagged for an organiser. A volunteer can withdraw from something they confirmed (organiser sees it).

## Stage 4 — Shared venue cover and the weekly overview ✅
**Migration** `20261019000400_hub_venue_cover.sql` (rollback tested; restores Stage 3 functions).
- Venue cover is one `hub_assignments` row (scope `venue`). Event pages derive it: **whole event**, **part of event**, or — when an event's finish isn't recorded — **at kick-off only**, never the whole event. Cancelled/changed cover updates every event at once; nothing is cloned.
- Changing a confirmed cover's times asks the person to reconfirm unless the organiser records that they agreed.
- Clash checks (cover and event invitations): only a different place at an overlapping time is a clash; same-venue overlap is fine. A clash needs a written note to save anyway.
- Overview counts each person once per event (confirmed > expected > available > awaiting) and once per day across events and cover.
**Screens** `/manage/venue-cover` (preview of overlapping events and clashes, request or record, change times, record answers, cancel), shared-cover band on the calendar and overview (“Also supports N overlapping events”), `/manage` overview (Needs attention + this week by day and venue, honest count badges).
**Tests** `tests/db/hub-venue-cover.db.test.ts` 16 (C26–C31, H32, scope, rollback), `tests/e2e/hub-stage4.mts` 18/18; Stages 1–3 E2E re-run green.

## Stage 5 — Club roles, recruiting and succession ✅
**Migration** `20261019000500_hub_positions.sql` (rollback tested).
- `club_positions`, `position_holders` (many-to-many, start/end dates, history never deleted), `position_interests` (interested → contacted → discussion → shadowing → handover; “taken on” is an internal note only).
- Occupancy is derived (vacant / filled / shared); recruiting flags are independent, so Filled + Seeking replacement, Filled + Extra help, both, and Vacant + Advertised all work.
- `public_opportunities()` — callable only by the server's secret key; returns public-safe copy for roles that are allowed public **and** actually recruiting. No names, contacts, notes or interest data. `anon` still executes nothing.
- “Add the usual roles” creates the eight roles as empty drafts (no holders, nothing advertised) — an explicit admin action.
**Screens** `/manage/club-roles` (+ `[id]`: recruiting, holders and hand-over, history, interest pipeline, details), `/opportunities` for members (I'm interested), public `/volunteer` and `/privacy` (draft notice, versioned); club roles shown in the directory.
**Tests** `tests/db/hub-positions.db.test.ts` 14 (C33–C35, interest, permissions, rollback), `tests/e2e/hub-stage5.mts` 17/17 (incl. C05 public redirects).

## Stage 6 — Public application and review inbox ✅
**Migration** `20261019000600_hub_applications.sql` (rollback tested; export applications first).
- `volunteer_applications` (admin-only), `application_role_suggestions`, `hub_rate_events`; `club_settings.contact_email / applications_open / application_retention_months`.
- `public_submit_application()` — secret key only; validates everything again, refuses under-18s, rate-limits (5/hour per hashed client, 3/day per contact), flags possible duplicates (email/phone vs people and applications) without merging, records role interest only for publicly advertised roles, computes explained suggestions, and returns only `{received: true}`. Answers are kept out of the audit log.
- Review: stages new → reviewing → contacted → trial → accepted into pool → closed, follow-up date, notes, link to an existing person (never overwrites them), add to directory (copies preferences; no login, no invite), note interest in a role, delete (an audit line without contents remains). Retention review date set only when the club configures a period.
**Endpoint** `POST /api/public/volunteer-applications`: same-origin only, JSON, size-capped, honeypot and minimum fill time (bots get the same generic success; nothing saved), never logs answers.
**Screens** `/volunteer/apply` (3 steps, in-memory with Back, “I'm not sure” option, under-18 route to contact the club with a parent/carer, privacy acknowledgement + separate optional news opt-in, agreed thank-you text), `/manage/applications` (+ `[id]`: answers, side-by-side duplicate check, suggestions with reasons and checks flag, review, add/link, delete).
**Tests** `tests/db/hub-applications.db.test.ts` 22 (C36–C42, H43, H44, rollback), `tests/unit/application-form.test.ts`, `tests/e2e/hub-stage6.mts` 25/25.
**Needs the club** contact address for the under-18 route (`CLUB_CONTACT_EMAIL`), privacy notice approval, retention period.

## Stage 7 — Notifications, legacy retirement, hardening and handover ✅
**Migration** `20261019000700_hub_notifications.sql` (rollback tested; restores the legacy worker functions).
- Hub messages go through the existing outbox (release switch, staging allow-list, demo suppression, re-check before send, retry): availability requests, direct invitations and cover requests, answers to the organiser, reconfirmations, cancellations, day-before reminders. A request's delivery state (queued / sent / failed / manual contact) is shown to organisers.
- Nothing is queued by creating people, events or applications, or by publishing. Recipients need an email and an enabled linked account; otherwise "contact them yourself".
- Settings: club contact email, applications on/off, retention period, reminders, email start/pause; CSV downloads (logged); "Remove their details" for leavers (anonymises person and legacy volunteer row).
- Legacy rota screens redirect unless `LEGACY_ROTA_UI=true`; legacy e2e scripts moved to `tests/e2e/legacy/`. Env template and `check-env` rules cover the Hub.
**Handover** `admin-guide.md`, `volunteer-guide.md`, `deployment-runbook.md`, `decisions-log.md`, `acceptance-matrix.md`, `supabase/seed-hub-demo.sql` (fictional, local/staging only).
**Tests** `tests/db/hub-notifications.db.test.ts` (C14, C50, H52), `tests/db/hub-rehearsal.db.test.ts` (C51: all 7 migrations forward then all rollbacks in reverse on production-shaped data, legacy checksums equal), `tests/db/hub-demo-seed.db.test.ts`; `tests/e2e/hub-demo.mts` 30/30 (owner's demo script, emails, axe WCAG 2.1 AA, 320px reflow, keyboard, cron lock, headers, no secrets in bundle).
**Live system** Read-only preflight on the live project: 0 problems. Nothing applied, sent or deployed.

**Security review** An independent review found no anon/PUBLIC exposure. One high and one medium issue were fixed in `20261019000800_hub_hardening.sql` (details in `decisions-log.md` §B2). Final run: `npm test` 41 files / 614 tests, lint and typecheck clean, `npm run e2e` all stages + demo (149/149 checks).
