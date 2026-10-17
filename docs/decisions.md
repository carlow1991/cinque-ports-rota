# Decisions log

Each entry has a status: **PROPOSED** means it is awaiting Carl's answer, **AGREED** means it is confirmed, and **SUPERSEDED** means it has been replaced. Anything still PROPOSED when its phase starts is built using the proposed default and flagged in that phase's report.

## Fixed (from the Spec and Catalogue; not open)
- D-001: This is a standalone repository and Supabase project, with no Carl OS access. **AGREED**
- D-002: Exactly nine duty codes, with no Parking or Steward duty. **AGREED**
- D-003: Invitations reserve no place. A `pending_approval` assignment reserves one place. Only `confirmed` counts as cover. **AGREED**
- D-004: Included responsibilities never add headcount or vacancies. **AGREED**
- D-005: No deployment and no real email sends without explicit approval. **AGREED**

## Open questions with proposed answers

### Q1 — Where the code lives and runs · **AGREED 16 Oct 2026: private GitHub repository**
This workspace currently cannot reach the npm registry, and it has no Docker daemon.
**Proposed:** Create a private GitHub repository `cinque-ports-rota` owned by the club, or by Carl on the club's behalf, and push Phase 0 to it. Do Phases 1–3 in an environment that has npm access, which could be this one if access returns, or a folder connected on Carl's computer.

### Q2 — Timings the Catalogue does not specify · PROPOSED
The Catalogue omits timings for some optional items. Proposed defaults are below. All of them are editable per event.

| Template | Item | Proposed timing |
|---|---|---|
| T02, T04 | General support (optional) | start → end |
| T03 | General support (optional) | start → end ("during event") |
| T04 | Refreshments (optional) | start −30 → end +15 (same as T02) |
| T04 | Gate (optional) | start −30 → start +15 (same as T02) |
| T05 | Site lead (conditional) | start −15 → end +15 |
| T06, T08, T09 | Site lead ("full period") | start +0 → end +0. The coverage event's own start and end define the operational window. |
| T06 | Refreshments / gate / general support (optional) | start → end |
| T07 | General support ×2 | start → end |
| T07 | Refreshments (optional) | start −30 → end +15 |
| T07 | Gate (optional) | start −30 → start +30 |
| T08 | General support ×3 | start → end |
| T08 | Setup (optional) | start −30 → start |
| T03 | Site lead (fallback, not linked) | start −60 → end +30 |

### Q3 — T03 gate row and T05 site lead · PROPOSED
- **T03 gate** ("0, off"): seed it as a disabled optional item with the guidance "Not normally used; enable only if the club collects admission". This matches the general optional-item mechanism and creates no row unless an organiser enables it.
- **T05 site lead** ("conditional"): seed it as `enabled_by_default=false`. The event has `site_responsibility` defaulting to **true**. Publishing is blocked unless one of the following applies:
  1. A site-lead shift is enabled.
  2. Adequate linked cover exists.
  3. An admin records `provider_verified` with a note.
  4. An admin records `not_required` with a reason.

  This matches the Catalogue's statement that a training event cannot be published without an explicit site-coverage decision.

### Q4 — Authorisation for composite shifts · **AGREED 16 Oct 2026: yes — primary duty AND every restricted included responsibility need their own valid authorisation**
`site_lead`, `open_unlock` and `lock_secure` default to `requires_authorisation=true`.
**Proposed:** To take a shift, a volunteer needs a valid authorisation for the primary duty **and** for every included responsibility that requires one. For example, a composite site lead with unlock and lock needs all three authorisations.
**Alternative:** require only a `site_lead` authorisation and treat it as implying the keyholder roles. This is simpler to administer, but it implies that every site lead is a keyholder.

### Q5 — "Required window" for an event linked to venue cover · **AGREED 16 Oct 2026: earliest setup start to end of cleaning (union of event times and all its active shifts)**
The Catalogue says linked cover must span "the relevant operational window" but does not define it.
**Proposed:** The required window is the earliest start to the latest end of the union of two sets of intervals:
- the linked event's own `starts_at`/`ends_at`;
- all of its active shifts, so that setup before kickoff and cleaning afterwards are also covered.

For the Catalogue §6 example, the youth block is 09:00–12:00, setup starts at 08:15 and cleaning ends at 12:30. The required window is therefore 08:15–12:30, which is inside the coverage event's 08:00–14:00, so it is covered.

### Q6 — Restricted duties: hard gate or approval · PROPOSED
**Proposed:** The authorisation check is a hard eligibility gate. A volunteer without a valid authorisation cannot sign up or accept, and the shift is shown as "Needs club authorisation". `approval_required` is a separate per-shift setting, defaulting to **false** for all seeded items. An admin can switch it on, for example for gate and cash duties.

### Q7 — Email provider · PROPOSED (needed before Phase 6)
Any transactional API that supports idempotency keys and a verified sending domain will work. Postmark, Resend and Amazon SES are all suitable. The club needs a domain it controls, and must also decide the sending address, for example `rota@<club domain>`.

### Q8 — Schema additions (build-progress §4) · PROPOSED
These add the following columns. The rationale for each is in build-progress §4.
- template items: `instructions`, `suppressed_by_linked_cover`, `sort_order`
- template: `code`, `description`
- events: `instructions`, `site_responsibility`, `is_demo`
- volunteers: `preferred_venue_id`
- assignments: `removal_reason`, `status_changed_at`
- shifts: `source_template_item_id`

### Q9 — Template ↔ event type and venue · PROPOSED
| Template | event_type | venue |
|---|---|---|
| T01, T02 | fixture | Marke Wood |
| T03, T04 | fixture | Freemens Way |
| T05 | training | any |
| T06, T09 | venue_coverage | any |
| T07 | club_event (also offered for `fundraising` and `meeting`) | any |
| T08 | maintenance | any |

A venue-specific template is only offered for events at that venue.

### Q10 — Coordinator visibility · PROPOSED
- Coordinators can see **draft** events at their venues only.
- They can see email and phone only for volunteers with an active assignment, meaning `invited`, `pending_approval` or `confirmed`, on their venues' events, plus a name-only picker of all active volunteers so that they can allocate.
- Volunteers never see drafts.

## Phase 1 decisions (16 Oct 2026)

- **D-101 Versions.** Next.js 16.4.2, React 19.3, @supabase/ssr 0.12.7, @supabase/supabase-js 2.118, zod 4.6, Tailwind 4.3 and Vitest 5. TypeScript 5.9 and ESLint 9 are kept because they are the versions `create-next-app` 16.4 pairs with Next.js. They will be upgraded only when Next supports TS 7 and ESLint 10.
- **D-102 Cache Components on, identity never cached.** Next 16 enables Cache Components, and the docs say it becomes mandatory in the next major release. Session and role reads are deliberately **not** wrapped in `use cache: private`, because that would let a suspended account keep cached access for up to 5 minutes. Each protected page reads the session inside a `<Suspense>` boundary on every request.
- **D-103 Authorisation location.** Layouts are static chrome only, because they don't re-run on client navigation. Every protected page and every Server Action or Route Handler calls the DAL (`requireVolunteer` / `requireRole`). `proxy.ts` (Next 16's renamed middleware) only refreshes the session and makes an optimistic redirect to /login. RLS is the final barrier.
- **D-104 Sign-in method.** The primary method is a 6-digit emailed code, which is more reliable on phones where email apps open links in a different browser. The emailed link (`/auth/callback?token_hash=…`) is also supported. Sign-up is impossible: `shouldCreateUser:false` is set, and public sign-ups are disabled in the dashboard.
- **D-105 Account linking.** `link_volunteer_account()` takes no arguments. It uses only `auth.uid()` and the Auth-held verified email, matched case-insensitively. It requires `invited_at` and `is_active`, and it never re-points a row that is already linked.
- **D-106 Supabase key naming.** The app uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`, following Supabase's current naming. Legacy anon and service_role keys work in the same variables.
- **D-107 Bootstrap invites.** Until the Phase 5 volunteer screen exists, admins are invited with `scripts/invite-volunteer.mts` on a trusted machine.
- **D-108 Branding.** **AGREED 16 Oct 2026:** the club colours are navy `#2a426f` (primary), blue `#0038c1` (links and hover) and orange `#f25c05`. Orange is used for **accents only** (header stripe, active tab, focus rings, badge ring), because it is 3.3:1 against white and fails WCAG for small text. Navy and blue pass at about 9 to 10:1 with white. The official badge is in `public/club-badge.png` and is also used for the app and home-screen icons (`src/app/icon.png`, `apple-icon.png`). Colours change in one place: `src/app/globals.css`.
- **D-109 Login rate-limiting.** This relies on Supabase Auth's built-in OTP limits (per address and per IP) for Phase 1. App-level limits for signup writes are added with the RPCs in Phase 2.

## Phase 2 decisions (16 Oct 2026)

- **D-201 Schema additions (Q8 applied).** Added `venues.code`, `duty_templates.code`, `duty_template_items.instructions` / `suppressed_by_linked_cover` / `sort_order`, `events.instructions` / `site_responsibility` / `is_demo` / `external_cover_verified_at` / `status_reason`, `event_shifts.source_template_item_id`, `assignments.status_changed_at` / `removal_reason`, and `volunteers.preferred_venue_id`. Also added a `shift_status` enum (`active`, `cancelled`) and a `cancellation_request_status` enum.
- **D-202 `notification_status` gains `suppressed`.** This is beyond the spec's four values. It marks messages that must never be sent: demo data, and reminders for commitments that were cancelled or are being reconfirmed.
- **D-203 Cycle-proof links.** A `venue_coverage` event may not itself link to another event, so links are always exactly one step and a cycle is impossible. The link must be to a **different** event at the **same** venue. A coverage event with dependants cannot change venue or type.
- **D-204 Restricted duties are a hard gate (Q6 applied).** An authorisation must be active and valid **until the shift ends**, for the primary duty **and every restricted included duty** (Q4). `approval_required` is separate, and defaults to off.
- **D-205 Invitations require eligibility and a published or postponed event.** Organisers can't invite someone who lacks the authorisation, and no emails go out for draft events.
- **D-206 Lowering headcount below committed volunteers is refused** (`below_committed`). Nobody is ever silently dropped. An organiser must remove someone first, with a reason.
- **D-207 Rescheduling.** Shifts generated from a template item are re-anchored to the new start and end (for example, cleaning follows the end). Hand-made shifts move by the start delta. Every active commitment returns to `invited` and must reconfirm, and pending places are freed.
- **D-208 Roster visibility.** A volunteer sees confirmed **names** on a published event only if they are themselves on that event. Organisers see rosters for their venues. Email and phone are never included.
- **D-209 Site-cover states.** `not_required`, `covered_by_provider`, `covered_by_volunteer`, `at_risk` (an arrangement exists but has gaps) and `no_cover`. Cover counts only confirmed, active and fully authorised site leads, across the agreed window (Q5).
- **D-210 Publishing** needs at least one duty plus an explicit site-cover decision whenever the club is responsible for the site.
- **D-211 Last-admin guard.** The last active administrator can't be demoted or suspended.
- **D-212 Sign-up rate limit.** A volunteer is limited to 20 assignment changes per minute, as basic abuse protection.
- **D-213 No physical deletes** of events, shifts or assignments for any app user. Cancel instead, so history is kept.

## Phase 3 decisions (16–17 Oct 2026)

- **D-301 Templates T01–T09** are seeded exactly from the catalogue. Timings the catalogue leaves open use the Q2/Q3 defaults. The seed is idempotent and **non-destructive**: re-running never overwrites an admin's later edits.
- **D-302 Linked cover suppresses, never duplicates.** Template site-lead items are marked "not created when linked". Linking later via `link_venue_cover()` removes an **uncommitted** generated lead duty and **keeps** one with people on it (reported back to the organiser). Linking is not shown as cover: the event shows "at risk" with exact uncovered times until a confirmed, authorised lead covers the whole window.
- **D-303 Event creation is atomic** (`create_event()`): the draft and all its generated duties are created together, or not at all.
- **D-304 Template application is idempotent.** An item already generated on an event is never generated again. Switching on more optional duties later adds only those. Editing or deleting a template never changes existing events.
- **D-305 UK time.** Organisers type UK wall-clock times. Each time is converted to an exact instant once, on the server. A time inside the spring-forward gap is rejected with an explanation. The repeated hour in autumn uses the first (BST) occurrence and is flagged. An end time earlier than the start means the next day. Template offsets are real elapsed minutes, so a duty 75 minutes before kick-off is 75 real minutes even across a clock change.
- **D-306 Demo data** lives only in `supabase/seed.sql`, which the Supabase CLI loads into **local** databases only. It refuses to run if real events exist, and every demo event is `is_demo` with a "DEMO" title. The app itself can no longer set `is_demo`, so an organiser can't accidentally suppress real emails.
- **D-307 Links change only via `link_venue_cover()`.** The direct column update was revoked.
- **D-308 Template admin** uses `admin_update_template_item()` (item + included duties atomically) and `admin_add_template_item()`.
- **D-309 Buttons wait for the page to be ready.** Sign-in and organiser buttons show "Loading…" until the page is interactive, so a tap on a slow phone is never silently lost. The app requires JavaScript, and a message says so if it's off.
- **D-310 Personal pages are always rendered per request** (`connection()` in the Supabase server client). Nothing user-specific is prerendered or shared.
- **D-311 End-to-end checks** use a test-only stand-in for Supabase's auth and data API (`tests/e2e/support/fake-supabase.mts`), running against real Postgres with real RLS, because the Supabase Docker images can't be downloaded in the build workspace. It is never used in production, and the real Supabase project should be smoke-tested at Phase 7.

## Phase 4 decisions (17 Oct 2026)

- **D-401 Security fix: function privileges.** PostgreSQL lets anyone execute a new function by default, and the Phase 2 per-schema revoke didn't change that. Ten Phase 3/4 functions were therefore callable without signing in. Each one still refused to act for a signed-out caller, but that must not be the only barrier. Migration `20261017000200_function_privileges_lockdown.sql` removes the default and re-locks everything to an explicit allow-list for signed-in users only. `tests/db/privileges.db.test.ts` checks every function, so a future function can't silently become public.
- **D-402 Volunteer reads come only from sanitised functions** (`volunteer_rota`, `volunteer_event_view`, `my_duties`). They return counts and the caller's own status, never another person's identity or contact details. Confirmed **display names** come from `event_roster`, only for people on the same event (D-208).
- **D-403 "Places you can take"** counts only sign-up duties the volunteer could take right now: authorised (including every restricted included duty), not already on it, not started, and no clash with their other confirmed or pending duties. Each duty explains in words why it can't be taken (full, needs authorisation, clash, organiser-filled, started).
- **D-404 Success only after commit.** Every volunteer button calls one atomic database function and shows success only from its committed result. The page then re-reads the database, so the status shown is the saved status. A lost race shows "Shift now full; please contact the organiser" and saves nothing.
- **D-405 My Duties tabs:** Confirmed, Awaiting response (invitations, shown first when any are waiting), Pending approval, Past (with attendance). Cancellations or removals of upcoming duties in the last 14 days appear as warnings at the top, so nobody turns up for a cancelled duty.
- **D-406 Withdrawal vs late cancellation.** Before the cut-off (default 24h), "Withdraw" frees the place. Inside it, only "Ask to cancel" is offered: the volunteer stays on the duty and organisers are alerted. The exact deadline is shown in UK time.
- **D-407 Add to calendar.** An `.ics` file for the volunteer's own confirmed duty only (looked up via `my_duties()`). It uses UTC times so any calendar shows correct local time. Any other ID returns not found.
- **D-408 Profile.** Volunteers can edit their display name, an optional phone (validated) and a preferred venue. Email and access level are shown read-only, with plain-English privacy information.
- **D-409 Not-found for hidden events.** Draft or unknown events show a friendly "Not found" page with no details. Because pages stream, the HTTP status can be 200 rather than 404. No event data is sent either way.

## Phase 5 decisions (17 Oct 2026)

- **D-501 Organiser reads are venue-scoped functions** (`manage_roster`, `manage_action_queue`, `event_cover_leads`). Organisers see a volunteer's **phone** for people on their venues' duties (Q10). Email is never returned by these functions.
- **D-502 Allocation picker** lists every active volunteer by name only. Each name is labelled Available / Needs authorisation (which duties) / Has another duty at this time / Already on it. People needing authorisation can't be invited. A clashing person can be invited, but can't accept until the clash is gone.
- **D-503 Needs action** collects late cancellation requests first, then approvals, then unanswered invitations, so organisers deal with the most urgent first. Invitations are listed but never counted as cover.
- **D-504 Losing the venue lead alerts every linked event.** This is a database trigger: when a confirmed site lead on a venue-cover event stops being confirmed (withdraws, is removed, late cancellation accepted, reset for reconfirmation), organisers of all linked events get a "venue cover at risk" message (Catalogue §7.8). Before, this only happened when the whole cover event was cancelled or moved.
- **D-505 Coverage page.** It shows "Site lead missing or at risk" with exact uncovered times, provider cover listed separately with no name, and duties needing people, filterable by venue, date (day/week), team and duty, with "Find someone" links. "Expected on site" counts **unique confirmed people** per half hour as a text table plus bars. It is labelled "expected", not "present".
- **D-506 Printable day rota** is one sheet per day: venue → event → duty, confirmed names and phone numbers, blank lines for open places, unconfirmed people in brackets, a "Here?" tick column, and a site-lead warning line. It carries a privacy reminder, and the app header and menus are hidden when printing.
- **D-507 Postpone vs cancel.** Postponing resets everyone to "invited". The organiser then sets the new date and publishes again, and volunteers reconfirm. Approval-required duties go back through approval, never straight to confirmed (Spec D5.3). Cancelling cancels all duties, notifies everyone and suppresses reminders. Both need a reason that volunteers see.
- **D-508 Volunteer administration.** Admins add or re-invite (email is normalised; re-adding never duplicates), change access, suspend, set coordinator venues atomically, and grant dated club authorisations. The last admin can't be demoted. Coordinators get a read-only list of the people on their venues' duties.
- **D-509 Invitation emails are behind `AUTH_INVITES_ENABLED` (default `false`).** Sending a Supabase Auth invite uses the server-only secret key (`src/lib/supabase/admin.ts`). That is the only elevated operation in the app, and it runs only after the RLS-checked `admin_create_volunteer()`. It stays off until the pilot is approved, so no real email can be sent by accident. A scan confirms the secret never appears in the browser bundle.
- **D-510 Organiser wording.** Errors shown to an organiser acting on someone else's duty say "This volunteer…", not "You…".

## Phase 6 decisions (17 Oct 2026)

- **D-601 The outbox is the only way email leaves the app.** Messages are written in the same database transaction as the change they describe (Phase 2). A server-only worker then sends them. The worker uses the secret key, but the database grants that role **only** four functions (`outbox_enqueue_reminders`, `outbox_claim`, `outbox_complete`, `outbox_suppress`). App users, admins included, can't read the outbox. Admins see a redacted summary (counts, last error, no addresses).
- **D-602 Exactly-once in practice.** `outbox_claim` hands each due message to one worker (`FOR UPDATE SKIP LOCKED`) and marks it `sending`. The outbox `dedupe_key` is sent to the provider as its `Idempotency-Key`. So if the worker crashes after sending but before recording it, the message goes back in the queue after 10 minutes and the provider returns the original result instead of sending again (tested end to end).
- **D-603 Retries.** 429, 5xx and network errors retry after 2, 4, 8 and 16 minutes, then the message is marked **failed** after 5 attempts. Other provider rejections (bad address, bad key) fail at once. Admins can put failures from the last 7 days back in the queue from Settings. Stored errors keep only the HTTP status and provider error name, with addresses redacted.
- **D-604 Safety gates, all independent.** (1) Nothing runs unless `EMAIL_SENDING_ENABLED=true` and the key, from-address, secret key and site URL are all set; it's **off by default**. (2) Demo events are suppressed when queued. (3) Outside `APP_ENV=production`, only `EMAIL_STAGING_ALLOWLIST` addresses receive email; others are **suppressed**, not left waiting, so switching to production later can't release a backlog. (4) At send time the database suppresses messages to suspended people and reminders for duties no longer confirmed, active, published and upcoming. (5) Any message about a duty that has already started is suppressed as stale.
- **D-605 Reminders** are queued for duties on **tomorrow's UK date** and are due at **18:00 UK time** the day before (or at once if that has passed). The key includes the date, so re-running never duplicates and a moved duty gets a fresh reminder. They can be switched off in Settings. Tested across the October clock change and the UTC/UK midnight boundary.
- **D-606 Immediate sending plus a safety-net schedule.** After each successful change the app sends that change's emails in the background (`after()`), so confirmations arrive within seconds whatever the schedule. The scheduled call to `/api/cron/outbox` queues reminders and handles retries. It needs `Authorization: Bearer <CRON_SECRET>` (constant-time check; refuses everything if the secret is missing or short). **Schedule:** every 5–15 minutes is ideal. Vercel's Hobby plan only allows daily cron jobs, so if the club is on Hobby, Phase 7 will use Supabase `pg_cron` + `pg_net` (or another scheduler) to call the same endpoint. The choice is made with Carl at Phase 7; no schedule is configured yet.
- **D-607 Email content.** Only the recipient's own duty: duty, event, venue, UK time with GMT/BST, any reason the organiser gave about **their** duty, and a link into the app. Organiser alerts name no volunteer. No rosters, phone numbers or other addresses. Everything is HTML-escaped and subjects can't contain line breaks. Unknown kinds are suppressed, not sent.
- **D-608 Provider: Resend (HTTP API).** It supports idempotency keys natively and needs no extra package (plain `fetch`). The club still needs to verify its sending domain (Q7, Phase 7). Swapping provider means replacing one small file (`src/lib/email/transport.ts`).
- **D-609 Logging** goes through `src/lib/log.ts`, which drops personal fields (email, name, phone, reason, bodies, keys) and scrubs addresses, phone numbers, tokens and keys from any text. The worker logs counts only.
- **D-610 Error screens and headers.** Volunteer, organiser and whole-app error screens show a plain message, a "Try again" button and a reference code, never internal details. Every response carries `nosniff`, `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'`, a strict referrer policy, HSTS and a restrictive permissions policy. `X-Powered-By` is removed. A full script CSP is deferred: it needs per-request nonces, which would conflict with the cached page shells, so Phase 7 will review it.

## Phase 7 decisions (17 Oct 2026)

- **D-701 Least privilege for the secret key.** Hosted Supabase gives `service_role` full access to new tables and functions. Migration `…000600` removes all of it and grants five functions only: the four outbox functions and `admin_bootstrap_volunteer()`. The first-admin script now uses that function rather than writing to tables (finding F-1, `security-review.md`).
- **D-702 Tests copy Supabase's real default privileges.** The test shim now grants `anon`, `authenticated` and `service_role` everything on new objects, as hosted Supabase does, so every privilege test runs against production-like grants. `security-audit.db.test.ts` pins each role's exact grants.
- **D-703 Committed `supabase/config.toml`** with the demo seed **disabled** (so `db push --include-seed` can't load demo data) and sign-ups off. It's used for the CLI and local development only. Never `config push` it to the club project. Rehearsed: the Supabase CLI 2.121 `db push` applied all migrations to a scratch database, a second push was a no-op, and `--include-seed` loaded nothing.
- **D-704 Pilot mode.** `APP_ENV=pilot` is the live site during the pilot: everything works normally, but only `EMAIL_STAGING_ALLOWLIST` (the pilot group) receives rota emails. General release is `APP_ENV=production`.
- **D-705 `scripts/check-env.mts`** validates a deployment's settings (secret in a `NEXT_PUBLIC_` value, keys swapped, http/localhost site address, short `CRON_SECRET`, half-configured email, test-only settings) and prints names, never values.
- **D-706 Privacy procedures as tested SQL.** Erasure (`docs/sql/anonymise-volunteer.sql`) and routine retention clean-up (`docs/sql/retention-cleanup.sql`) are run by an admin in the SQL editor. Each file is executed verbatim by the database tests, so the documented procedure is the tested one.
- **D-707 Schedule.** Vercel Pro → `vercel.json` cron every 10 minutes. Vercel Hobby (once a day only) → Supabase Cron + pg_net with the secret stored in Vault (`deployment-checklist.md` 2.3). Club decision A6. No `vercel.json` is committed yet, because a frequent schedule would fail deployment on Hobby.
- **D-708 Backups.** Supabase Pro daily backups (7 days) plus a monthly CLI export following Supabase's official three-file procedure. Free has no backups and pauses inactive projects, so Pro is recommended for production.
