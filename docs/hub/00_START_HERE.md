# Start Here — Cinque Ports FC Volunteer Hub
**Prepared:** 18 October 2026  
**Purpose:** Complete, repository-aware build specification and phased instructions for Claude Code.

## What this is
A ready-to-use instruction pack for modifying the existing `rota.cinqueportsfc.co.uk` application. The assistant producing this pack does **not** have the source repository or permission to run database migrations or deploy. Therefore these are detailed build instructions, data contracts and acceptance criteria, **not a claim that the live application is already implemented**.

The old October 16 rota pack, including compulsory staffing templates, is **superseded** by this pack. Keep the old pack only for historical reference.

## How to use it
1. Unzip the pack into your existing application repository **on a new branch**, preserving the directory structure. Put `CLAUDE.md` in the project root (merge with an existing CLAUDE.md if necessary rather than replacing important instructions).
2. Open Claude Code in that repository and paste:

> Read `CLAUDE.md` and all six documents in `docs/`. We are converting the existing Cinque Ports FC rota into a simple Volunteer Hub. Begin with Stage 0: inspect the repository, auth, database schema, migrations, UI, deployed configuration and tests. Produce the architecture/migration/permission audit and a file-by-file plan. Do not modify production, deploy, send invitations or delete data. Then implement Stage 1 on a feature branch and run checks; continue stage-by-stage. The new specification supersedes old mandatory shift templates. Summarise each stage and call out any approvals genuinely required for production or external notifications.

3. Review the schema migration plan before allowing any existing data to be changed.
4. Pilot on staging with test records; only then promote to production.

## Deliverables in this pack
- `CLAUDE.md`: ongoing engineering rules
- `docs/01_PRODUCT_AND_WORKFLOWS.md`: what the hub must do
- `docs/02_DATA_MODEL_AND_SECURITY.md`: entities, states, roles, data separation, migration
- `docs/03_UX_SCREENS_AND_QUESTIONNAIRE.md`: screen-by-screen UX and full application questions
- `docs/04_DELIVERY_STAGES.md`: Claude Code stage prompts, outputs and hold points
- `docs/05_ACCEPTANCE_TESTS.md`: scenarios Claude must implement and test
- `docs/06_INITIAL_SETUP_AND_DECISIONS.md`: club-specific example configuration and implementation defaults

## Principles
- One person, many club roles, possibly no login.
- One event calendar for all club activity, even information-only and away events.
- Event availability = response (yes/no + time), not assignment.
- Direct invitation = asked to help (pending until accepted/declined).
- Expected by role = likely to attend as part of a club position, **not confirmed**.
- Venue-wide assignment = one slot covering any number of overlapping fixtures.
- Occupied role can simultaneously advertise a replacement or extra support.
- Public volunteer questionnaire works without an account, creates a reviewable record, **never** portal access.
- No mandatory shift templates, headcount quotas, complicated approvals or full task manager.

## External setup needed before emails go live
Staging Supabase project, transactional email provider and verified sending domain, deployment env secrets, approved privacy notice/retention setting, club admin account(s), and verified team/position mappings. These are not to be guessed, hard-coded or silently configured.
