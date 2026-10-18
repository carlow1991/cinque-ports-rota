# Stage 0 — Audit of the existing rota and plan for the Volunteer Hub

**Date:** 18 October 2026 · **Branch:** `hub/volunteer-hub` (from `main` @ `98c0f6d`)
**Scope:** read-only. No production writes, no emails, no deploys. The live database was inspected with read-only `select` queries only.

## 1. What exists today

| Area | Finding |
|---|---|
| Stack | Next.js **16.4.2** (App Router, `proxy.ts` instead of middleware), React 19.3, Tailwind 4, `@supabase/ssr` 0.12, supabase-js 2.118, zod 4, Vitest 5, Playwright 1.56, Node 22. Matches the recommended stack, so it is kept. |
| Auth | Supabase email OTP, invite-only (`shouldCreateUser:false`). `/auth/callback` and the code form call `link_volunteer_account()`, which links `auth.users` to a pre-created `volunteers` row **by verified email only**. Guards in `src/lib/auth/dal.ts` (`requireVolunteer`, `requireRole`) re-check on every request. Solid; reused with a people-based link function. |
| Data access pattern | Server Components read through RLS or `SECURITY DEFINER` "sanitised read" functions; Server Actions validate with zod and call narrow RPCs that re-derive the caller from `auth.uid()`. `anon` can execute **no** function; `service_role` only the outbox worker and admin bootstrap (swept by `tests/db/privileges.db.test.ts`). This is exactly the model the new spec asks for, so new code follows it. |
| Schema | 17 tables, 11 enums, ~100 functions across 20 migrations: `volunteers`, `venues`, `teams`, `coordinator_venues`, `duty_types` (the nine duties), authorisations, `duty_templates` T01–T09 + items, `events` (+ `coverage_event_id` venue-cover linking), `event_shifts`, shift responsibilities, `assignments` (shift-based, 7 statuses), cancellation requests, `notification_outbox`, `audit_log`, `club_settings`. |
| Screens | Volunteer: `/rota`, `/rota/[eventId]`, `/my-duties`, `/profile`. Organiser: `/manage` (overview), `/manage/calendar`, `/manage/coverage` (+print), `/manage/approvals`, `/manage/events/new` (template-driven builder), `/manage/events/[id]` (shifts/people tabs), `/manage/shifts/[id]/assign`, `/manage/volunteers`, `/manage/templates`, `/manage/settings`. |
| Email | Resend via outbox: `outbox_claim/complete/suppress`, retries, dedupe keys, reminders, `EMAIL_SENDING_ENABLED` + `APP_ENV` allow-list + an admin "release" switch. All OFF by default. Reusable for the Hub. |
| Tests | 26 files / **414 tests pass** (unit + DB tests against a throwaway local Postgres with a Supabase shim). E2E scripts run the production build against a test-only fake Supabase. `npm run typecheck` fails only until Next generates route types (`PageProps`) during a build — pre-existing, not a code fault. |
| Deployment | Not deployed to Vercel; no GitHub deployments recorded, so pushing a branch does **not** deploy anything. One Supabase project, "Cinque Ports Rota" (eu-west-2). Carl OS is a separate project and was not touched. |
| Unmerged work | `improve/shared-cover` (Increment 7: site-lead split) was never applied to production and builds on the template model that this redesign retires. **Not merged.** |

### Live database (read-only counts, 18 Oct 2026 23:2x)
| Table | Rows | Notes |
|---|---|---|
| volunteers | 1 | one admin, linked to the only Auth user |
| venues | 2 | Marke Wood **active**, Freemens Way **active** (spec wants it inactive → Stage 2 data change, needs approval) |
| teams | 0 | |
| events | 1 | "Reserves vs Sandwich Town", published, 31 Oct 12:30–16:30, Marke Wood |
| event_shifts | 4 | from a template |
| assignments / authorisations / outbox | 0 / 0 / 0 | |
| audit_log | 71 | |

All 20 repository migrations are present in production, but `supabase_migrations.schema_migrations` records only **8** (the rest were pasted in the SQL editor). Running `supabase db push` as-is would try to re-run 12 migrations. `docs/sql/align-migration-history.sql` must be run first (approval needed).

## 2. Reuse vs retire

| Keep and reuse | Extend | Retire from normal UX (data kept read-only) |
|---|---|---|
| Framework, auth flow, proxy, Supabase clients, DAL pattern, zod actions, `ActionResult`/friendly errors, UI primitives and club colours, `lib/time/london.ts` (DST-safe), email transport + safety gates, outbox worker design, DB test harness, fake-Supabase E2E harness, privileges sweep | `venues` (Freemens Way → inactive), `teams` (seed list verified by admin), `events` (nullable end and venue, external location, category, volunteers toggle, visibility, organiser), `audit_log` (actor person + source), `club_settings` (privacy version, contact, retention), `notification_outbox` (person recipients) | Templates T01–T09 and their editor, `event_shifts`, shift-based `assignments`, approvals, cancellation requests, authorisations, coverage-event linking and site-lead coverage states, attendance, headcounts. The nine `duty_types` rows stay as the **optional tag list**. |

`volunteers` is **replaced** by `people` + `user_accounts`, bridged with the **same UUIDs** so every legacy foreign key, audit row and Auth link still resolves.

## 3. Migration and data-preservation strategy

Additive, staged migrations (`20261019*`), each with a rollback script in `docs/sql/`. Nothing is dropped.

1. **Stage 1** creates `people`, `user_accounts`, `team_people`, `coordinator_scopes`, `volunteer_preferences`, `usual_availability`. Copies each `volunteers` row into `people` (same `id`) and, where it was invited/linked, into `user_accounts` (`admin→admin`, `coordinator→coordinator`, `volunteer→member`, same `auth_user_id`). `coordinator_venues` copies into `coordinator_scopes`. Login switches to `link_person_account()`, which accepts already-linked accounts unchanged (so Carl keeps access).
2. **Stage 2** relaxes `events` (venue or external location; `ends_at` nullable) and adds the Hub columns. The existing event keeps its ID and gets `category='match'`. Its four shifts stay as history. Freemens Way is set inactive (no event or reference is removed).
3. **Stages 3–6** add new tables only: `availability_requests`, `event_availability`, `hub_assignments` (event **or** venue scope — named so it never collides with the legacy shift `assignments`), `event_participation_exceptions`, `club_positions`, `position_holders`, `position_interests`, `volunteer_applications`, `application_role_suggestions`.
4. **Legacy shift assignments** are not converted automatically: production has none. If any appear before release, they are reported for review, never silently "confirmed".
5. **Stage 7** adds person-addressed notifications to the outbox, a reversible `LEGACY_ROTA_UI` flag for the old screens, and a rehearsed migration on a copy of the production schema with pre/post row counts.

**Rollback:** each Hub migration has a `docs/sql/rollback-2026101900x00.sql` that drops only what that migration added and restores relaxed constraints where data allows. The pre-Hub code is tagged `legacy-rota-final` for a code rollback.

## 4. Permission gaps to close (new model)

- No concept of a person **without** a login → `people` with nullable email; accounts in `user_accounts`.
- Coordinators are venue-scoped only → add team scope (`coordinator_scopes`).
- Directory privacy: members must see only deliberately shared contact cards → all non-admin reads go through sanitised functions; `people` RLS allows only self and admin.
- Public pages (opportunities, application) need data without giving `anon` any table or function access → server-side routes use the secret key to call **two** narrowly scoped functions (published opportunities; submit application). `anon` still executes nothing. The privileges sweep test is extended to enforce this.
- Every new table: RLS on, all privileges revoked from `anon`, `authenticated`, `service_role`, then explicit grants.

## 5. Stage plan and files

| Stage | Migration | Main files |
|---|---|---|
| 1 | `20261019000100_hub_people.sql` | `src/lib/auth/{access,dal}.ts` (person-based), login + callback, `src/components/hub-nav.tsx`, `src/app/(hub)/{home,people,my-profile}`, `src/app/(manage)/manage/people/*`, `src/lib/data/hub-people.ts`, tests `tests/db/hub-people.db.test.ts`, `tests/unit/hub-access.test.ts` |
| 2 | `…0200_hub_calendar.sql` | `src/app/(hub)/calendar/*`, `src/app/(manage)/manage/events/*` (replaced), `src/lib/domain/hub-calendar.ts` |
| 3 | `…0300_hub_availability.sql` | event detail sections, response and invite actions, `src/lib/domain/involvement.ts` |
| 4 | `…0400_hub_venue_cover.sql` | `/manage/venue-cover`, weekend overview on `/manage`, `src/lib/domain/venue-cover.ts` |
| 5 | `…0500_hub_positions.sql` | `/manage/club-roles`, `/opportunities`, public `/volunteer` |
| 6 | `…0600_hub_applications.sql` | `/volunteer/apply`, `src/app/api/public/volunteer-applications/route.ts`, `/manage/applications`, `src/lib/domain/role-match.ts` |
| 7 | `…0700_hub_notifications.sql` | outbox for Hub sends, legacy flag, guides, runbook |

## 6. Risks

| Risk | Mitigation |
|---|---|
| Production migration history out of step (8 of 20 recorded) | Align before any `db push`; documented in the runbook. |
| Spec asks for a staging Supabase project; none exists (decision A7) | Development and acceptance testing run on throwaway local Postgres databases and the fake-Supabase harness. A real staging project needs Carl's approval (free tier). |
| `ALTER TYPE … ADD VALUE` cannot be used in the same transaction | New event categories are a checked `text` column, not new enum values. |
| Old and new login both active during transition | One link function (`link_person_account`); legacy `volunteers` rows stay but are no longer used for access. |
| Legacy RPCs assume `ends_at`/`venue_id` are never null | Legacy UI hidden; legacy functions only ever see legacy events. Tests cover the relaxed constraints. |
| Public form abuse | Server-only endpoint, honeypot, per-IP and per-contact rate limits, strict zod, generic responses. |

## 7. Decisions that genuinely need Carl

1. **Apply the Hub migrations to the live project** (and align migration history first) — after reviewing this branch.
2. **Staging:** create a free second Supabase project, or accept local-only testing before production.
3. **Freemens Way** set inactive in the live data (spec says so; currently active).
4. Real people, emails and **team ↔ manager mappings** (Scott, Danny, Matty) — only demo data is created here.
5. **Privacy notice text, retention periods, under-18 contact route, club contact email** — placeholders are used and clearly marked.
6. **Which held posts seek a successor or extra help** — flags default off.
7. Email provider/domain and turning email on (unchanged from `club-decisions.md` A3).

Everything else is decided pragmatically below and recorded in `docs/hub/decisions-log.md`.
