# Claude Code — Cinque Ports FC Rota Build Prompts

**How to use:** Place **both** `Cinque_Ports_Volunteer_Rota_V1_Build_Spec.md` and `Duty_Catalogue_and_Venue_Templates_V1.md` in `docs/` in the new repository. Open that **new** repository in Claude Code; do not open the Carl OS repository. Give Claude the prompts below **one at a time**, checking each stage before moving on.

## Prompt 0 — Audit and build plan

Read `docs/Cinque_Ports_Volunteer_Rota_V1_Build_Spec.md` **and** `docs/Duty_Catalogue_and_Venue_Templates_V1.md` in full. You are my senior full-stack engineer and security-minded architect. This is a NEW standalone Cinque Ports FC volunteer rota application, not a modification of Carl OS. First inspect this repository and its current dependencies. Produce a proposed folder structure, database entity relationship outline, implementation phases, security model, migration approach, email strategy, risks and explicit acceptance criteria. Flag any ambiguity rather than silently making risky assumptions. Create a checklist in `docs/build-progress.md`. Do not implement the application yet. Prioritise a simple, fast and reliable phone experience.

## Prompt 1 — Foundation and invitation-only login

Implement only Phase 1 of the specification: a Next.js TypeScript App Router app with responsive design, Supabase SSR Auth, invitation-only users, admin/coordinator/volunteer route restrictions and branded sign-in. Create `.env.example`; never hardcode keys. Use currently documented library versions, not outdated boilerplate. Add tests covering inactive/uninvited accounts and server-side auth enforcement. Run lint, typecheck and tests and report results. Do not start Phase 2 without my instruction.

## Prompt 2 — Database and robust authorization

Implement only Phase 2: all V1 PostgreSQL schema migrations, constraints, indexes, carefully scoped RLS policies and atomic assignment transaction functions. Include template item time anchors and enabled-by-default, normalized composite responsibility tables, coverage-event linking with same-venue/no-cycle guards and explicit provider-coverage verification fields. Seed precisely the nine canonical duty types from the separate catalogue. Avoid generic elevated RPC functions. Implement and test permissions: volunteer own records only, admin global, coordinators venue-scoped, no anonymous access. Test last-spot concurrent signup, overlap prevention, forbidden role changes, authorisation expiry, event cancellation, time changes and status transitions. Produce a table-by-table permissions matrix and test report. Stop after Phase 2.

## Prompt 3 — Event administration

Implement only Phase 3: CRUD for venues/teams, duty types/templates, event builder, template-driven shift creation, draft/publish editing, UK time-zone-safe event and shift times, venue calendar and validation. Seed and implement the nine template presets T01–T09 in `docs/Duty_Catalogue_and_Venue_Templates_V1.md` with exact proposed staffing, optional gate/refreshments toggles, event-start/end time anchors, and bundled site lead+open+facility check+lock responsibility (one staffed slot). Support linking multiple fixture events to a single venue-wide coverage event and accurate full-window lead coverage warnings; never double-count or automatically create duplicate vacancies. Make overlapping events at one venue work. Seed demo content in a development-only mode with visible DEMO labels and disable real email sends for demo. Test template offsets, including before-start and after-end shifts, and DST/cross-midnight cases. Explicit assertions: T01 with gate+tea bar enabled creates five shift rows and eight shift slots; T03 with a confirmed linked site-lead creates no duplicate site-lead row; T09 creates one composite site-lead row by default. Test disabled optional roles produce no vacancies. Stop after Phase 3.

## Prompt 4 — Volunteer portal

Implement only Phase 4: mobile-first Rota, event detail, My Duties and Profile screens. Volunteers can see eligible vacancy counts, take eligible shifts, request approval where configured, accept/decline invitations, and withdraw/request cancellation subject to cutoff. All writes use atomic server-side operations; don't fake success before database commit. Do not display other volunteers' contact information. Add realistic mobile usability tests. Stop after Phase 4.

## Prompt 5 — Coverage and administrative control

Implement only Phase 5: organiser allocation, scoped coordinator workflow, pending approvals, staffing coverage dashboard, venue/day filtering, missing site lead warnings, printable rota, attendance and robust postpone/cancel/reconfirmation flows. Counts must distinguish confirmed, pending approval and invited; composite responsibilities must not inflate headcount. Test cancellation of venue-wide lead triggers missing coverage warnings for every linked fixture; approved provider coverage must be visually separate from a named confirmed volunteer. Add conflict and permission tests. Stop after Phase 5.

## Prompt 6 — Email, polish and security

Implement only Phase 6: notification outbox, secure sender worker, idempotent delivery, confirmation/change/cancellation/reminder messages, retry logic and no secrets in frontend. Add accessible loading/error/empty states, production logging without sensitive details, timezone checks and security regression tests. Run lint, typecheck, full test suite. Stop after Phase 6.

## Prompt 7 — Pilot release

Prepare, but do not initiate without my explicit permission, staging and production deployment. Create a deployment checklist, environment setup instructions, backup and recovery documentation, privacy/access-review guidance, data ownership and administrator handover. Run all automated tests and review RLS permissions and email safety. Recommend a controlled volunteer pilot before general release. Provide exact remaining actions that require manual club decisions.

## During all phases

- Do not modify Carl OS or another live project.
- Preserve completed functions and migrations; never wipe real production data.
- Make the actual execution output of tests visible; don't claim unrun tests passed.
- Prefer high-quality, maintainable and accessible implementation over decorative dashboards.
- Don't introduce packages unless necessary, and verify current upstream docs when uncertain.
- Don't deploy or send real notifications without explicit approval.
