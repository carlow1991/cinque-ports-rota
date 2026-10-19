# Cinque Ports FC Volunteer Hub — Claude Code project instructions

This is a **redesign of the existing rota application**, not authorisation to replace a production system or lose data. The product brief in `docs/hub/01_PRODUCT_AND_WORKFLOWS.md` supersedes any old rota/shift-template specification.

## Read in order
1. `docs/hub/01_PRODUCT_AND_WORKFLOWS.md`
2. `docs/hub/02_DATA_MODEL_AND_SECURITY.md`
3. `docs/hub/03_UX_SCREENS_AND_QUESTIONNAIRE.md`
4. `docs/hub/04_DELIVERY_STAGES.md`
5. `docs/hub/05_ACCEPTANCE_TESTS.md`
6. `docs/hub/06_INITIAL_SETUP_AND_DECISIONS.md`

## Guardrails
- Inspect existing repository, framework, auth, database migrations, deployment and tests before proposing changes.
- **Do not modify production data, send real invitations, publish events, delete legacy tables, execute destructive migrations, or deploy without explicit approval.**
- Build on a feature branch. Use a development/staging Supabase project. No access to Carl OS data.
- Keep the initial UI extremely simple. A person record is independent of any portal account. Event availability is separate from assignments and team-role expectations.
- Prior event-duty templates and required-headcount shift management are obsolete requirements. Preserve historical data while retiring their UX. The nine former duty categories are optional interests/labels only.
- Store UK-local dates using Europe/London properly; use timestamptz for actual instants. Verify DST transitions.
- Permission checks must run server-side and at the database boundary; no service-role secrets in browser code.
- Ask for approval at migration/deployment/notification boundaries. For normal implementation detail, choose the simplest reasonable solution, document assumptions, and proceed.
- For each stage: implement, add tests, run lint/typecheck/tests/build, summarise changed files, and state what still needs setup.

## Definition of done
Refer to the numbered scenarios in `docs/hub/05_ACCEPTANCE_TESTS.md`; all critical cases must pass. Deliver source changes, migrations with rollback strategy, environment template, seed examples (not actual production inserts), tests, admin guide, volunteer guide, and deployment runbook.
