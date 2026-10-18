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
