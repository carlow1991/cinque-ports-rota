# Cinque Ports FC — Volunteer Hub

Invite-only club Volunteer Hub (calendar, people, availability, venue cover, club roles, public volunteer
applications) for Cinque Ports FC. It replaces the earlier volunteer rota and duty-template system, keeping
all of its data. **Not part of Carl OS**, with no shared code, database or credentials.

**Status:** Hub redesign built and tested on branch `hub/volunteer-hub` (Stages 0–7). **Not deployed and
not applied to the live database** — see `docs/hub/decisions-log.md` §A and `docs/hub/deployment-runbook.md`.

| Hub document | Purpose |
|---|---|
| `CLAUDE.md`, `docs/hub/00–06*.md` | Hub specification pack (supersedes the rota specs below) |
| `docs/hub/stage-0-audit.md` | Audit of the existing app, reuse/replace and migration plan |
| `docs/hub/progress.md` | What each stage built and tested |
| `docs/hub/acceptance-matrix.md` | Every C/H acceptance test mapped to its automated evidence |
| `docs/hub/admin-guide.md` / `volunteer-guide.md` | How organisers and volunteers use the Hub |
| `docs/hub/deployment-runbook.md` | Backup, migration, deploy, smoke test, rollback |
| `docs/hub/decisions-log.md` | Decisions needed from the club, and those made pragmatically |
| `docs/sql/hub-preflight.sql`, `docs/sql/rollback-20261019*.sql` | Read-only preflight; tested per-stage rollbacks |
| `supabase/seed-hub-demo.sql` | Fictional demo data for local/staging only |

Tests: `npm test` (unit + database, needs local Postgres on 54329), `npm run e2e` (browser, fake Supabase), `npm run e2e:demo` (owner demo script).

### Earlier rota documentation (history; still accurate for the legacy tables and email setup)

| Document | Purpose |
|---|---|
| `docs/Cinque_Ports_Volunteer_Rota_V1_Build_Spec.md` | Product and technical specification |
| `docs/Duty_Catalogue_and_Venue_Templates_V1.md` | Nine duty types and the T01–T09 templates (authoritative for duties) |
| `docs/Claude_Code_Stage_Prompts.md` | Phase-by-phase build prompts |
| `docs/build-progress.md` | Audit, architecture, plan and progress checklist |
| `docs/decisions.md` | Open questions and agreed decisions |
| `docs/acceptance-tests.md` | Acceptance test catalogue |
| `docs/permissions-matrix.md` | Who can read/write what, table by table and RPC by RPC |
| `docs/test-report-phase-*.md` | Test results per phase (verbatim) |
| `docs/screenshots/phase-*/` | Screens at phone width |
| `tests/e2e/run.sh` | Run an end-to-end check against a fresh local test database |
| `docs/setup.md` | Connect Supabase, configure Auth, invite the first admin, run locally |
| `docs/deployment-approach.md` | GitHub + Vercel + Supabase deployment plan (no deploy without approval) |
| `docs/deployment-checklist.md` | Step-by-step staging → production, schedule options, rollback |
| `docs/environment-setup.md` | Every setting, per environment (`npm run check-env` validates them) |
| `docs/backup-and-recovery.md` | Backups, monthly export, restore scenarios |
| `docs/privacy-and-access-review.md` | Data held, privacy notice, quarterly access review, erasure and retention |
| `docs/data-ownership-and-handover.md` | Account ownership and administrator handover |
| `docs/admin-guide.md` | How administrators and organisers use the rota |
| `docs/pilot-plan.md` | Recommended 4-week controlled pilot and go/no-go |
| `docs/club-decisions.md` | Decisions and manual actions still needed from the club |
| `docs/security-review.md` | RLS, permissions and email-safety review |
| `docs/sql/` | Admin SQL procedures (tested): erasure, retention clean-up |

Template staffing numbers are **suggested, editable defaults**, not statutory, FA or grounds-safety minimums.
The rota is not a safeguarding record and stores no DBS data.
