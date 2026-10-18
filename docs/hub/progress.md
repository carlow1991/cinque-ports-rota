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
