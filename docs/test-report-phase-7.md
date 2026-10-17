# Phase 7 test report (pre-pilot full run)

**Date:** 17 October 2026 · PostgreSQL 16.15 (with Supabase's default privileges copied) · Supabase CLI 2.121 · Node 22.22 · Next.js 16.4.2 · Vitest 5.0.5 · Playwright 1.56 (375×812, touch)
**Nothing was deployed and no real email was sent.**

| Check | Result |
|---|---|
| Lint / Typecheck | ✅ exit 0 / exit 0 |
| Unit + database tests | ✅ **375 / 375** (22 files) |
| Fresh production build + phone checks, all phases (one run, in order) | ✅ Phase 3 **25/25** · Phase 4 **37/37** · Phase 5 **47/47** · Phase 6 **39/39** · Phase 7 **19/19** |
| Server log across all runs | ✅ 0 error lines; 0 test email addresses or phone numbers |
| Secrets in browser bundle / rendered pages | ✅ none (Phase 6 scan, this build) |
| Supabase CLI `db push` rehearsal (scratch database) | ✅ 15 migrations applied (now 16 with `…000600`, re-checked by the test suite); re-push "up to date"; `--include-seed` skipped the demo seed; result 9 duties, 9 templates, 2 venues, 0 events |
| Security audit mutation check | ✅ `security-audit` fails (4 tests) without migration `…000600`, passes with it |
| Erasure procedure mutation check | ✅ `anonymise` fails if the audit clean-up step is removed |

## New in Phase 7
- `security-audit.db.test.ts` (13): RLS on every table, `search_path` on every definer function, policies signed-in only, exact grant snapshots for `anon` / `authenticated` / `service_role`, first-admin bootstrap.
- `anonymise.db.test.ts` (4): runs `docs/sql/anonymise-volunteer.sql` and `retention-cleanup.sql` **verbatim**. No trace of name, email, phone or reasons remains anywhere; refusals for upcoming duties, last admin, unknown email.
- `env-rules.test.ts` (10): the pre-deployment settings check, including that it never echoes a value.
- `phase7-pilot.mts` (19): below.

## Defects found and fixed in Phase 7
1. **F-1: the secret key had full database access in real Supabase** (`security-review.md`). It is now limited to 5 functions. The test shim copies Supabase's defaults so this can't hide again.
2. The first-admin script wrote to tables directly, which F-1's fix would have broken. It now uses `admin_bootstrap_volunteer()` and is tested end to end.
3. A default `supabase init` config would let `db push --include-seed` load demo data. The committed config disables it, and the rehearsal confirmed the seed is skipped.
4. Two test-script assumptions (the demo count in the test database, the dashboard heading). No app change was needed.

## Per-file unit and database results (verbose run)
```
      4 tests/db/anonymise.db.test.ts
     36 tests/db/assignments.db.test.ts
      8 tests/db/concurrency.db.test.ts
     26 tests/db/coverage.db.test.ts
      3 tests/db/demo-seed.db.test.ts
     14 tests/db/organiser.db.test.ts
     15 tests/db/outbox.db.test.ts
     53 tests/db/permissions.db.test.ts
      5 tests/db/privileges.db.test.ts
     13 tests/db/security-audit.db.test.ts
      5 tests/db/seed.db.test.ts
     29 tests/db/templates.db.test.ts
     12 tests/db/volunteer-views.db.test.ts
     20 tests/db/volunteers-foundation.db.test.ts
     18 tests/unit/access.test.ts
     42 tests/unit/email.test.ts
     10 tests/unit/env-rules.test.ts
     14 tests/unit/london-time.test.ts
     24 tests/unit/server-enforcement.test.ts
      4 tests/unit/staffing.test.ts
     15 tests/unit/templates.test.ts
      5 tests/unit/volunteer-helpers.test.ts
```

## Phase 7 pilot-readiness checks (verbatim)
```
PASS  bootstrap script invites a new admin (✔ Invited Pat Pilot (admin). They'll receive an email to join.)
PASS  …saved with a normalised email, admin role, active, invited
PASS  …and a sign-in account was created through the Auth invite
PASS  running it again doesn't duplicate the person (✔ Volunteer row ready. An Auth user already exists for this address, so they can sign in at http://localhost:3200/login)
PASS  the script fails with the public key instead of the secret key
PASS  …and saved nothing
PASS  secret key can't read volunteers' emails or phones directly (HTTP 401)
PASS  secret key can't read the audit history (HTTP 401)
PASS  anonymous visitors can't call the bootstrap function (HTTP 401)
PASS  demo seed refuses to load into a database with real events (psql:supabase/seed.sql:16: ERROR:  Refusing to load DEMO data: this database already contains real events.)
PASS  …and no demo events were added (6 → 6)
PASS  bootstrapped admin signs in and lands in the organiser area (/manage)
PASS  /manage renders for the new admin
PASS  /manage/volunteers renders for the new admin
PASS  /manage/settings renders for the new admin
PASS  /manage/templates renders for the new admin
PASS  /rota renders for the new admin
PASS  nine duties and both venues are ready in a fresh club database
PASS  no server errors while browsing
19/19 checks passed
```

## Earlier phases, same build (summary lines, verbatim)
```
phase3-smoke: 25/25 checks passed
phase4-volunteer: 37/37 checks passed
phase5-organiser: 47/47 checks passed
phase6-email: 39/39 checks passed
```
