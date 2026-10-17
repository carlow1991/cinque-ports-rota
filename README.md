# Cinque Ports FC — Volunteer & Venue Rota

Standalone, invite-only volunteer rota for Marke Wood and Freemens Way.
**Not part of Carl OS**, with no shared code, database or credentials.

**Status:** All build phases complete. Pilot release prepared and tested; **not deployed** (awaiting the club decisions in `docs/club-decisions.md`). See `docs/setup.md` to run it locally.

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
