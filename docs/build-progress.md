# Cinque Ports FC Volunteer Rota — Phase 0 Audit, Build Plan & Progress Checklist

**Date:** 16 October 2026
**Status:** Phase 0 complete. **Awaiting review.** No application code written.
**Sources:** `docs/Cinque_Ports_Volunteer_Rota_V1_Build_Spec.md` (the "Spec") and `docs/Duty_Catalogue_and_Venue_Templates_V1.md` (the "Catalogue"). Where they differ, the Catalogue governs duty and template content. The Spec governs everything else.

---

## 1. Repository audit

| Item | Finding |
|---|---|
| Repository | New, empty git repo `cinque-ports-rota` (branch `main`). It contains only `docs/`. There is no relationship to Carl OS. |
| Carl OS | Not present in this workspace and not touched. No code, credentials or database from Carl OS will be referenced. |
| Existing dependencies | None. There is no `package.json`. |
| Runtime available | Node 22.22, npm 10.9, git 2.43, PostgreSQL 16 client and server binaries. |
| **Blocker (Phase 1)** | The npm registry is **not reachable** from this workspace (DNS lookup fails). Packages cannot be installed or version-checked here. See Risk R1. |
| **Blocker (Phase 2)** | The Docker CLI is present but the **daemon is not running**, so `supabase start` (the local Supabase stack) cannot run here. See Risk R2. |
| Remote | No GitHub remote yet. The work lives in this cloud workspace only until a remote is agreed. See Decision Q1. |

---

## 2. Proposed technology stack

The exact versions will be pinned in Phase 1 against the npm registry and current upstream docs. They are not guessed here.

- **Next.js (App Router), TypeScript in strict mode, React.** Server Components handle reads and Server Actions handle writes.
- **Tailwind CSS**, plus a small set of hand-built accessible primitives (button, field, dialog, tabs, badge). No large UI kit, to keep dependencies minimal and pages fast on phones.
- **Supabase** for Postgres, Auth (email OTP, invite-only) and RLS, using `@supabase/ssr` cookie sessions and `@supabase/supabase-js`.
- **zod** for validating input at every Server Action boundary.
- **Vitest** for unit and domain tests. **pgTAP or SQL-driven tests** via `supabase test db`, or a plain Postgres harness, for RLS and transaction tests. **Playwright** for mobile-viewport end-to-end tests at 375px.
- **Email provider** (Phase 6): a transactional API provider with a verified club domain. The choice is a club decision (Q7).
- **Hosting** (Phase 7, only with approval): Vercel with staging and production, and two separate Supabase projects.

---

## 3. Proposed folder structure

```
cinque-ports-rota/
├─ README.md
├─ .env.example                 # names only, never values
├─ docs/                        # spec, catalogue, prompts, decisions, acceptance tests, progress
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/              # 0001_extensions_enums.sql, 0002_core_tables.sql, ... numbered, append-only
│  ├─ seed/                    # 01_venues.sql, 02_duty_types.sql, 03_templates_T01_T09.sql (idempotent, keyed by stable code)
│  ├─ seed_demo/               # DEMO-only fixtures; never loaded in production
│  └─ tests/                   # pgTAP: rls_*.sql, rpc_*.sql, coverage_*.sql
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/          # branded sign-in
│  │  ├─ auth/callback/         # route handler: verify + link volunteer
│  │  ├─ (volunteer)/rota/, rota/[eventId]/, my-duties/, profile/
│  │  ├─ (manage)/manage/       # dashboard, calendar, events/new, events/[id], coverage, volunteers, templates, settings
│  │  └─ api/cron/outbox/       # secret-protected worker endpoint (Phase 6)
│  ├─ lib/
│  │  ├─ supabase/              # server.ts, client.ts, middleware.ts (SSR cookie helpers)
│  │  ├─ auth/                  # requireVolunteer(), requireRole(), requireVenueScope()
│  │  ├─ domain/                # PURE functions: template expansion, time anchors, coverage intervals, counts
│  │  ├─ time/                  # Europe/London formatting and conversion
│  │  └─ email/                 # outbox writers, templates, sender (server-only)
│  ├─ actions/                  # Server Actions → narrow RPCs only
│  └─ components/               # accessible primitives + feature components
├─ tests/
│  ├─ unit/                     # Vitest: domain/, time/
│  └─ e2e/                      # Playwright, 375px viewport
└─ middleware.ts                # session refresh only; authorisation is NOT done here
```

**Principle:** business rules that matter, such as template expansion, coverage intervals and counts, live in two tested places only. These are the pure TypeScript `lib/domain` (for previews and UI) and the Postgres functions (the authority for writes). The SQL functions are the single source of truth for anything that mutates data. Tests cross-check that the TypeScript preview matches the SQL result.

---

## 4. Database entity relationship outline

```
venues 1─* events *─0..1 teams
venues 1─* coordinator_venues *─1 volunteers
events 0..1─► events (coverage_event_id → a venue_coverage event, same venue, no cycles)
events 1─* event_shifts *─1 duty_types
event_shifts 1─* event_shift_responsibilities *─1 duty_types      (composite: no headcount)
event_shifts 1─* assignments *─1 volunteers                        (unique shift_id+volunteer_id)
assignments 1─* cancellation_requests
volunteers 1─* volunteer_duty_authorisations *─1 duty_types
duty_templates 0..1─ venues ; duty_templates 1─* duty_template_items *─1 duty_types
duty_template_items 1─* template_item_responsibilities *─1 duty_types
notification_outbox *─1 volunteers ; audit_log *─0..1 volunteers ; club_settings (single row)
volunteers 0..1─1 auth.users (auth_user_id, unique nullable)
```

**Tables are as in Spec §E, with these proposed additions.** Each one is flagged for approval in `docs/decisions.md`.

| Addition | Why |
|---|---|
| `duty_template_items.instructions text` | Catalogue §3 lists instructions per item, but the Spec table omits the column. |
| `duty_template_items.suppressed_by_linked_cover boolean` | Marks the site-lead item that must **not** be generated when adequate linked venue cover exists (T01–T05, T07, T08). This makes it explicit rather than inferred from the duty code. |
| `duty_template_items.sort_order int` | Gives a stable preview and print order. |
| `duty_templates.code text unique` (`T01`…`T09`) and `description` | Provides stable seed identity. Spec §H requires that seeds key by stable values, not display labels. |
| `events.instructions text` | Spec D1 mentions event instructions, but there is no column for them. |
| `events.site_responsibility boolean` | Records whether the club is responsible for site operations for this event. This drives the "cannot publish without a site-coverage decision" rule (T03, T05). |
| `events.is_demo boolean` | Hard guard: the outbox refuses to send for demo events (Spec §H). |
| `volunteers.preferred_venue_id` (nullable) | `/profile` lists a venue preference, but the Spec table has no column for it. |
| `assignments.removal_reason`, `assignments.status_changed_at` | D5 requires a reason for removal. |
| `event_shifts.source_template_item_id` (nullable) | Supports idempotent re-application and explicit mapping on template change (Spec §E, final bullet). |

**Key constraints:** `CHECK (starts_at < ends_at)` on events and shifts. `CHECK (required_count >= 1)` on shifts and template items. Unique `(shift_id, volunteer_id)`. Unique `duty_types.code`. `citext` unique email. Unique nullable `auth_user_id`. A trigger enforces that `coverage_event_id` references a **different** event with `event_type='venue_coverage'`, the **same venue**, and no cycle, and that a `venue_coverage` event cannot itself link to one. A trigger also enforces that a template item's included responsibilities never repeat its primary duty. The indexes are those listed in Spec §E.

**Derived, never stored:** confirmed, pending and invited counts, open slots and site-coverage status are computed in SQL views or functions. They are never kept as denormalised counters, which avoids drift.

---

## 5. Core business rules (precise definitions to implement)

1. **Template expansion.** For each **enabled** item, set `shift.starts_at = anchor(start_anchor) + start_offset` and `shift.ends_at = anchor(end_anchor) + end_offset`. The calculation is done on absolute `timestamptz`. Offsets are real elapsed minutes, so a DST change between the anchor and the shift is handled correctly. Disabled items produce **no row**. Included responsibilities are copied into `event_shift_responsibilities`. The result must satisfy `starts_at < ends_at`, or the preview flags it.
2. **Headcount.** For each shift, `confirmed` is the count of rows with status `confirmed`. `pending` and `invited` are counted the same way. `open = max(0, required − confirmed − pending)`. Responsibilities never add headcount. Event totals are the sum over **active** shifts.
3. **Overlap.** This applies to a single volunteer: it is blocked if `existing.start < new.end AND new.start < existing.end`, across **all** venues. Only `confirmed` and `pending_approval` assignments block, and only on active shifts of non-cancelled events. Back-to-back shifts (where one ends exactly when the next starts) are allowed.
4. **Eligibility.** For a duty, a volunteer must be active. If the shift's **primary duty or any included responsibility** has `requires_authorisation`, the volunteer needs an active, unexpired authorisation **for each such duty**. For example, a composite site lead with lock and unlock needs `site_lead`, `open_unlock` and `lock_secure`. Agreed (Q4).
5. **Site coverage of a linked event.** The *required window* runs from the earliest start to the latest end across the linked event and all its active shifts, from setup to the end of cleaning (Q5, agreed). The window is **covered** only if the union of intervals from the coverage event's active shifts satisfies both conditions below for every point in the window:
   - The shift's primary duty is `site_lead`.
   - The shift has at least one `confirmed` assignment whose volunteer is currently eligible.

   Any gap is reported as an explicit interval list. `provider_verified` on the coverage event, or on the event itself, counts as covered but is reported as a **distinct state**. The resulting states are `covered_by_volunteer`, `covered_by_provider`, `at_risk` (with gap intervals), `not_required`, and `no_link`.
6. **Locking order** in every assignment RPC is: volunteer row first (`FOR UPDATE`), then shift row. Inside the transaction, the function re-checks status, eligibility, capacity, overlap and scope before writing. Writes go to the assignment, the audit row and the outbox row together.

---

## 6. Implementation phases (each one ends with a stop for review and a git commit)

| Phase | Deliverable | Key tests |
|---|---|---|
| **0** ✅ | This plan, decisions, acceptance tests, README, `.env.example` | none |
| **1** | Next.js scaffold, Tailwind, Supabase SSR clients, `/login` (OTP, `shouldCreateUser:false`), `/auth/callback` link-by-verified-email, `requireVolunteer`/`requireRole` guards, role-gated layouts, branded sign-in. Phase 1 uses only a minimal `volunteers` table migration, which is needed for the guards. | Uninvited email gets a generic response and no account is created. An inactive volunteer is rejected server-side on every route group. A volunteer cannot reach `/manage`. Forged cookie or role claims are rejected. |
| **2** | All migrations, enums, constraints, triggers, RLS on every table, narrow RPCs (`self_signup`, `accept_invitation`, `decline_invitation`, `approve_assignment`, `reject_assignment`, `withdraw`, `request_cancellation`, `allocate`, `remove_assignment`, `cancel_event`, `reschedule_event`, `update_shift`, `mark_attendance`), and a sanitised roster function. Seeds the 2 venues and the 9 duty types. | Two concurrent last-spot signups result in exactly one success. Overlap is enforced across venues. Role elevation is denied. An expired authorisation is denied. Cancellation, time change and status transition matrix. Anonymous users are denied everywhere. Coordinator at venue A is denied at venue B. Produces a permissions matrix and test report. |
| **3** | Venues and teams CRUD, duty types and templates admin, seed of T01–T09, event builder with preview and optional toggles, draft and publish, coverage linking, calendar, DEMO seed with email hard-off. | T01 with gate and refreshments gives 5 rows and 8 slots. T03 with confirmed linked lead gives no site-lead row. T09 gives 1 composite row. Disabled optional items give 0 rows. Before-start and after-end offsets, DST in March and October, cross-midnight. |
| **4** | `/rota`, `/rota/[eventId]`, `/my-duties`, `/profile` (mobile-first). | Playwright at 375px: sign in and sign up in under 1 minute. No horizontal scroll. No other volunteers' contact details visible. Success is shown only after commit. |
| **5** | Allocation, approvals queue, coverage dashboard with time-axis view, missing-lead warnings, printable rota, attendance, postpone, cancel and reconfirm. | Cancelling the venue lead warns every linked event. Provider cover is visually distinct. Composite shifts do not inflate counts. Coordinator scope negative tests. |
| **6** | Outbox worker, email templates, idempotency, retries with backoff, reminders in Europe/London, loading, error and empty states, log redaction. | Retrying does not duplicate an email. Cancellation suppresses reminders. Demo data never sends. Reminder date is correct around DST. |
| **7** | Deployment checklist, environment setup, backups, privacy and handover docs. **No deployment without explicit approval.** | Full suite plus an RLS review. |

---

## 7. Security model (summary; full detail in Spec §F)

- **Identity:** Supabase Auth email OTP only. `shouldCreateUser:false`. Accounts are created by an admin invite, which pre-creates the `volunteers` row. The callback links `auth_user_id` **only** by matching the verified Auth email to an active, invited, unlinked volunteer row. A client-supplied volunteer id is never accepted.
- **Authorisation, enforced in three layers:**
  1. Server Action and page guards check the session, active status, role and venue scope.
  2. RPCs are `SECURITY DEFINER` with a fixed `search_path`. Each one re-derives the caller from `auth.uid()` and re-checks every rule. They are narrow and single-purpose, with no generic "update table" functions.
  3. RLS sits on **every** table, and `anon` has no grants.
- **Direct table writes** from the client: none for `assignments`, `volunteers.role`, authorisations, attendance or event status. All such changes go through RPCs. `UPDATE` grants are column-limited, for example to a volunteer's own `display_name` and `phone`.
- **Privacy:** volunteers see only names of people on the *same published event*, via a sanitised function. Email, phone, authorisations and audit data are never readable by volunteers. Coordinators see contact details only for volunteers assigned to their venues' events.
- **Secrets:** the service-role key is server-only and limited to the outbox worker and admin invite. It is never imported into client components, and a lint rule or `server-only` import enforces this. The cron endpoint is protected by a secret header.
- **Safeguarding:** only a boolean authorisation and an expiry date are stored. There are no DBS fields. The UI states that site presence is not a safeguarding qualification.
- **Abuse:** login OTP requests are rate-limited (Supabase Auth limits plus a per-IP check). Signup RPC calls are rate-limited per volunteer.

---

## 8. Migration approach

- Numbered, append-only SQL migrations in `supabase/migrations`. A merged migration is never edited; fixes go in new migrations.
- Seeds are idempotent (`INSERT … ON CONFLICT (code) DO UPDATE`) and keyed by stable codes (`site_lead`, `T01`). Template items are keyed by `(template_code, primary_duty_code, sort_order)`.
- Demo seed is a separate file, loaded only when `APP_ENV=development`, and every demo event has `is_demo=true` and a `DEMO` title prefix.
- Each migration is verified by applying it from scratch, then re-running the seeds twice to prove idempotency.
- **Rollback:** a down script is provided where it is safe to do so (pre-pilot). After real data exists, recovery is forward-fix plus point-in-time backup only. Destructive downs are never run against production.

---

## 9. Email strategy

- Postgres functions write `notification_outbox` rows **in the same transaction** as the change. Each row has a deterministic `dedupe_key`, for example `confirm:{assignment_id}:{status_changed_at}` or `reminder:{assignment_id}:{shift_starts_at_local_date}`.
- A secret-protected server worker (Vercel Cron, Phase 7) claims due rows using `FOR UPDATE SKIP LOCKED`. It sets `sending`, sends using the provider's idempotency key equal to `dedupe_key`, then marks the row `sent` or `failed` and applies exponential backoff. A manual retry button is available for admins.
- Reminders are computed in `Europe/London`, for the day before the shift's local date. They are suppressed if the assignment or event is no longer active **at send time**, not just at enqueue time.
- Content is limited to the recipient's own duty, time, venue and instructions. Emails never contain rosters, other people's details or cash-handling notes.
- Hard stops apply: no sending if `is_demo`, if `APP_ENV != production` (unless the recipient is allow-listed), or if `EMAIL_SENDING_ENABLED != true`.
- Supabase Auth's own emails (invite, OTP) use Supabase SMTP on the same verified club domain.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **npm registry unreachable in this workspace**, so Phase 1 cannot install packages here. | Option (a): connect a folder on Carl's computer and run Phase 1 there. Option (b): retry here in case the issue was transient. Option (c): push to a GitHub repo and use Claude Code on that repo. The decision is needed before Phase 1 (Q1). |
| R2 | No Docker daemon, so the local Supabase stack cannot run here. | Run Phase 2 SQL tests against the local Postgres 16 with a minimal `auth` schema shim (`auth.uid()` driven by a session setting). Re-run the same tests with `supabase test db` on a machine with Docker before Phase 7. |
| R3 | Concurrency bugs leading to overbooking. | Use row locks in a fixed order and re-check inside the transaction. Run real parallel-connection tests in Phase 2, not mocks. |
| R4 | Coverage wrongly shown "green". | Coverage is computed from confirmed and eligible intervals at read time. A link alone never counts as cover, and gaps are listed explicitly. |
| R5 | DST and timezone errors. | Store UTC `timestamptz` and convert only at the edges. Unit tests cover 29 Mar 2026, 25 Oct 2026, 28 Mar 2027, 31 Oct 2027, and cross-midnight shifts. |
| R6 | Personal data leakage through RLS gaps or emails. | Deny-by-default RLS. A negative test for every table and role. A sanitised roster function. Email payload review. |
| R7 | Accidental real emails during testing or demo. | Three independent guards (`is_demo`, environment, kill switch), plus an allow-list in staging. |
| R8 | Scope creep, such as a fancy dashboard. | Phase gates. Plain, accessible tables and lists first. |
| R9 | Template numbers mistaken for official minimums. | UI labels say "suggested default, editable", and the catalogue disclaimer is shown on the templates page. |
| R10 | Single-admin lock-out. | Require a second admin before pilot (Phase 7). Document a recovery route via the Supabase dashboard. |

---

## 11. Ambiguities flagged (no risky assumption made; see `docs/decisions.md` for proposed answers)

Q1 repository and build location · Q2 timings not given in the Catalogue · Q3 T03 gate row and T05 site-lead default · Q4 composite-shift authorisation rule · Q5 the "required window" for a linked event · Q6 restricted duties: hard gate vs approval · Q7 email provider · Q8 schema additions in §4 · Q9 T07 event type · Q10 coordinator visibility of drafts and contacts.

---

## 12. Progress checklist

### Phase 0 — Audit & plan
- [x] Spec, Catalogue and stage prompts read in full; copied into `docs/`
- [x] New standalone repo created; Carl OS untouched
- [x] Folder structure, ER outline, phases, security model, migration approach, email strategy, risks
- [x] `docs/decisions.md` with open questions and proposed defaults
- [x] `docs/acceptance-tests.md`
- [x] `README.md`, `.env.example` (names only)
- [x] Q1 (GitHub), Q4 (separate keyholder authorisations), Q5 (setup→cleaning window) agreed 16 Oct 2026
- [ ] Private GitHub repo created by Carl and Phase 0 pushed
- [ ] Q2, Q3, Q6–Q10 — proposed defaults stand unless Carl changes them

### Phase 1 — Foundation & invitation-only login ✅ (16 Oct 2026, awaiting review)
- [x] Scaffold Next.js 16.4 + TS strict + Tailwind 4 (versions verified against npm on 16 Oct 2026)
- [x] Supabase SSR server/browser clients + `src/proxy.ts` session refresh
- [x] Minimal `volunteers` migration, `link_volunteer_account()`, identity helpers, RLS + column grants
- [x] `/login` branded two-step OTP (code or link); `/auth/callback` verified-email link; POST-only sign-out
- [x] Server-side guards on every protected page: inactive / uninvited / role
- [x] Tests: 20 database (real Postgres 16, RLS) + 42 unit/server-enforcement = 62 passing; mutation-checked
- [x] Lint, typecheck, production build clean; 375px check (no overflow, keyboard focus, errors keep input)
- [x] `docs/setup.md` (dashboard settings, email templates, first-admin invite)
- [ ] Carl: apply migration + dashboard settings, invite himself, sign in on his phone

### Phase 2 — Database & authorisation ✅ (16 Oct 2026, awaiting review)
- [x] Enums, all V1 tables, constraints, indexes (`…000200`); integrity triggers (`…000300`)
- [x] Coverage-link guard: same venue, coverage-type target, no self/chains (cycle-proof)
- [x] Normalised composite responsibilities (template + shift), never repeating the primary duty
- [x] Provider-cover fields with admin, note and timestamp, enforced by CHECK
- [x] RLS on all 17 tables, deny-by-default grants, column-limited updates (`…000400`)
- [x] 19 narrow RPCs + 4 safe read functions; volunteer→shift lock order; outbox + audit in-transaction (`…000500`)
- [x] Seed: 2 venues, exactly 9 duty types, settings; idempotent (`…000600`)
- [x] `docs/permissions-matrix.md`, `docs/test-report-phase-2.md`
- [x] Tests: 148 database (incl. 8 real-concurrency) + 42 unit = 190 passing; mutation-checked

### Phase 3 — Event administration ✅ (17 Oct 2026, awaiting review)
- [x] T01–T09 seeded exactly (`…000700`); idempotent, non-destructive
- [x] `create_event` (atomic), `apply_template` (idempotent), `add_shift`, `link_venue_cover`, `manage_events_overview` (`…000800`); template admin RPCs (`…000900`)
- [x] UK time handling (DST gap/overlap, cross-midnight) + template expansion in TypeScript, cross-checked against the database for all nine templates
- [x] Screens: dashboard (7 days), venue calendar (overlaps, filters), event builder with live preview and optional toggles, event page (publish, cover status with exact gaps, link cover, edit/remove/add duties, reschedule, details), templates (view/edit), settings (venues, teams, duties, rota rules)
- [x] Dev-only DEMO seed (`supabase/seed.sql`), email hard-off
- [x] Tests: 251 unit + database passing; 25/25 phone-width end-to-end checks (×2 runs)
- [x] Required assertions: T01+gate+tea = 5 rows / 8 slots; T03 linked to confirmed lead = no site-lead row; T09 = 1 composite row; disabled optional = no rows

### Phase 4 — Volunteer portal ✅ (17 Oct 2026, awaiting review)
- [x] Sanitised volunteer reads: `volunteer_rota`, `volunteer_event_view`, `my_duties` (`20261017000100`)
- [x] **Security fix:** function execute privileges locked to an allow-list; sweep test (`20261017000200`)
- [x] Rota (venue tabs, type/team filters, "places you can take", next weeks), Event (duties with plain-English reasons, sign up / request approval / accept / decline, names-only roster), My Duties (4 tabs, withdraw before cut-off, late cancellation request, add to calendar), Profile (name, phone, venue preference, privacy, sign out)
- [x] Tests: 272 unit + database; 37/37 phone-width volunteer checks (×3 runs) incl. keyboard-only, privacy, lost race, suspension; Phase 3 organiser checks still 25/25

### Phase 5 — Coverage & admin control ✅ (17 Oct 2026, awaiting review)
- [x] Venue-scoped organiser reads: roster (with phone), action queue, site-lead names (`20261017000300`)
- [x] Lead-loss alerts to every linked event via trigger (`20261017000400`)
- [x] Event page: people per duty with status in words, approve/decline, remove (reason), late-cancellation decisions, attendance, complete; postpone/cancel with reasons; named lead vs provider cover
- [x] Invite page with eligibility/clash picker; Needs action queue; Coverage (missing lead with exact gaps, provider separate, gaps by venue/date/team/duty, expected-on-site table); printable day rota
- [x] Volunteers admin: add + invite (switch, default off), access/suspend, coordinator venues, dated authorisations; coordinator read-only scoped list
- [x] Tests: 290 unit + database; 47/47 organiser phone checks (×3); Phase 3 25/25 and Phase 4 37/37 still pass

### Phase 6 — Email, polish, security
- [ ] Outbox worker, templates, idempotency, retries, reminders
- [ ] States, logging redaction, security regression; commit

### Phase 7 — Pilot release (no deploy without approval)
- [x] Deployment approach agreed: GitHub + Vercel + Supabase, same as Carl OS, fully separate resources (`docs/deployment-approach.md`)
- [ ] Docs: deployment, environment, backup/recovery, privacy, handover
- [ ] Full suite + RLS review; pilot recommendation; club decision list
