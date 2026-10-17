# Pre-pilot security review: RLS, permissions and email safety

**Date:** 17 October 2026 (Phase 7). **Scope:** migrations `…000100` to `…000600`, the Next.js app, the email worker.
**Method:** each claim below is backed by an automated test (named). The tests run against migrations applied **on top of Supabase's real default privileges**, which the test shim now copies (D-702), and the Supabase CLI's own `db push` was rehearsed against a scratch database.

## Finding fixed in this phase
**F-1 (medium): the secret key had full database access.** Hosted Supabase automatically grants `service_role` everything on every new table, function and sequence, and that role bypasses RLS. Phase 2 locked down `anon` and `authenticated` but not `service_role`, so the server-only secret key could read every volunteer's email and phone, the audit history and the outbox through the Data API. Earlier tests didn't show it because the local test shim didn't copy Supabase's defaults.
*Exposure:* none in practice. The key is server-only, isn't in the browser bundle (scanned each phase), and only three code paths use it. But a leaked key would have exposed everything.
*Fix:* migration `20261017000600_service_role_least_privilege.sql` revokes it all and grants exactly five functions: the four email-worker functions and `admin_bootstrap_volunteer()` (now used by the first-admin script instead of direct table writes). The test shim now copies Supabase's defaults, so this class of gap can't hide again.
*Evidence:* `security-audit.db.test.ts` fails (4 tests) without the migration and passes with it; `phase7-pilot.mts` shows the secret key refused (HTTP 401) when reading volunteers or the audit history through the API.

## RLS and permissions: review result
| Check | Result | Test |
|---|---|---|
| RLS on every table | ✅ all 17 | `security-audit` |
| Every `SECURITY DEFINER` function pins `search_path` | ✅ all | `security-audit` |
| Every RLS policy is for signed-in users only | ✅ none for `anon` | `security-audit` |
| Anonymous visitors: no table, column, sequence or function | ✅ | `security-audit`, `privileges` |
| Signed-in users: exact grant snapshot; no direct writes to assignments, cancellations, authorisations, audit or the outbox; email, role, status, times, venue and `is_demo` never client-writable | ✅ pinned | `security-audit` |
| Signed-in users: exactly 53 named functions; internal helpers uncallable | ✅ | `privileges` |
| Secret key: exactly 5 functions, no tables | ✅ (after F-1) | `security-audit`, `phase7-pilot` |
| Row rules: own rows, venue scope for coordinators, names-only rosters, no contact details to volunteers, suspended = no identity | ✅ | `permissions`, `volunteer-views`, `organiser`, `phase4/5` e2e |
| Concurrency: no overbooking under parallel sign-ups | ✅ (mutation-checked in Phase 2) | `concurrency` |
| Last administrator can't be removed (app, bootstrap and erasure SQL) | ✅ | `organiser`, `security-audit`, `anonymise` |
| Page guards repeat the database checks on the server; layouts never authorise | ✅ | `server-enforcement`, e2e role checks |
| Secrets absent from the browser bundle and rendered pages | ✅ | `phase6-email` scan |
| Security headers (nosniff, frame-deny, CSP frame-ancestors, referrer, HSTS, permissions) | ✅ | `phase6-email` |
| Sign-in: invite-only (`shouldCreateUser:false` + sign-ups off in Supabase), open-redirect-safe callback | ✅ | `access` unit tests, Phase 3 e2e; **dashboard setting is a manual step** (checklist 1.3) |

## Email safety: review result
| Risk | Control | Test |
|---|---|---|
| Real email sent by accident | Off by default (`EMAIL_SENDING_ENABLED`). Refuses to run if half-configured. All tests use a fake provider | `email` unit, `phase6-email` |
| Email to people outside the pilot or staging group | Allow-list enforced unless `APP_ENV=production`; others **suppressed for good** (no backlog later) | `email` unit, `phase6-email` |
| Demo data emails | Suppressed when queued, and again in the worker | `outbox`, `phase6-email` |
| Duplicate emails | Claimed once (`SKIP LOCKED`); provider idempotency key = dedupe key; sent rows never re-claimed | `outbox`, `phase6-email` (crash-retry case) |
| Out-of-date emails | Re-checked at send time: suspended recipient, cancelled duty, duty already started | `outbox`, `email` unit |
| Someone else's details in an email | Payload holds only the recipient's own duty; organiser alerts name nobody; escaped; no rosters | `email` unit, `phase6-email` |
| Cron endpoint abuse | Constant-time bearer check; fails closed if the secret is missing or short | `email` unit, `phase6-email` |
| Addresses in logs or stored errors | Redacting logger; stored errors keep the status only | `email` unit, `outbox`, server-log scan |
| Provider daily limit (Resend free: 100/day) | 429s retry with backoff, then appear as failed with an admin retry | `email` unit. **Watch during the pilot** (`pilot-plan.md`) |

## Residual risks (accepted or for the club)
1. **Postgres 17:** new Supabase projects run 17; tests run 16 and use no version-specific features. *Mitigation:* staging push first (checklist 1.2).
2. **No full script CSP** (D-610): needs per-request nonces, which conflicts with cached page shells. The app renders no user HTML (React escapes everything), so XSS risk is low. Revisit if third-party scripts are ever added.
3. **Dashboard settings can't be tested from code** (sign-ups off, redirect URLs, SMTP). *Mitigation:* checklist ticks plus the staging smoke test.
4. **Printed day rota contains phone numbers** (by design for match days). *Mitigation:* guidance to bin sheets securely (club decision B7).
5. **Single-region hosting and Supabase plan.** On Free there are no backups and the project pauses. *Mitigation:* Pro recommended (A6) plus monthly exports.
6. **People with dashboard access can see everything.** *Mitigation:* two-factor authentication, two named owners, the quarterly access review.
