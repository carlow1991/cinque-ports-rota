# Phase 3 test report

**Date:** 17 October 2026 · PostgreSQL 16.15 · Node 22.22 · Next.js 16.4.2 · Vitest 5.0.5 · Playwright 1.56 (Chromium)

## Results

| Check | Result |
|---|---|
| Lint | ✅ 0 problems |
| Typecheck | ✅ 0 errors |
| Production build | ✅ success; 0 server errors during the end-to-end run |
| Unit + database tests | ✅ **251 / 251** (12 files) |
| Phone-width end-to-end checks (375px, admin / coordinator / volunteer) | ✅ **25 / 25**, repeated across 3 clean runs |

### Required Phase 3 assertions (all passing)
- T01 with gate + tea bar enabled → **5 shift rows, 8 slots**; open/check/lock are included responsibilities, not rows (database, unit and end-to-end).
- T03 linked to venue cover with a **confirmed** site lead → **no site-lead row**, and cover reported as covered.
- T09 → **one** composite site-lead row spanning the window.
- Disabled optional roles → **no rows and no vacancies**.
- Offsets before start and after end; spring-forward gap; autumn repeated hour; cross-midnight; a full 15-minute sweep of both 2026 clock-change days.
- The on-screen preview matches the rows the database creates, for **all nine templates**, across a clock-change night.

### How the end-to-end checks ran
The Supabase Docker images can't be downloaded in the build workspace. The end-to-end checks therefore use a **test-only** stand-in for Supabase's sign-in and data API (`tests/e2e/support/fake-supabase.mts`). It runs every request against the real Postgres database **as the signed-in role**, so the real RLS policies, grants and functions are exercised. It issues signed tokens that the app verifies exactly as it does with Supabase. It is not production code. A smoke test on the club's real Supabase project is listed for Phase 7.

## Defects found and fixed in Phase 3
1. **Template seed couldn't be re-run in the same session** (temporary helper functions already existed). Now uses `create or replace`.
2. **"Published" confirmation vanished** because the Publish panel disappears once published. Publishing now returns to the event page with a lasting notice.
3. **Personal pages could touch the pre-renderer** (the auth client reads the clock on creation). Supabase server clients now always render at request time (`connection()`).
4. **A tap before the page finished loading was silently lost on the sign-in form.** Buttons now say "Loading…" and stay disabled until the page is ready. A no-JavaScript notice was added.
5. **Organiser menu items were cut off at phone width.** The menu now wraps.
6. **Coordinator's venue filter listed a venue they can't manage.** It now lists only their venues.
7. Safety: the app could mark events as demo, which suppresses emails. That permission is revoked; only the local seed can create demo events.

## End-to-end output (verbatim)
```
PASS  admin lands on organiser dashboard
PASS  dashboard: no horizontal scroll at 375px
PASS  calendar shows both venues' DEMO events in UK time
PASS  calendar flags the same-venue overlap
PASS  calendar shows DEMO labels
PASS  calendar: no horizontal scroll at 375px
PASS  builder preview: T01 + gate + tea = 5 rows, 8 places (5 duty row(s), 8 place(s) to fill. Not the number of people needed at once.)
PASS  builder shows site lead includes open/check/lock
PASS  new event: no horizontal scroll at 375px
PASS  created event has exactly 5 duty rows (5)
PASS  event page shows 0/8 confirmed
PASS  publish is saved, then confirmed on the page
PASS  event page: no horizontal scroll at 375px
PASS  linked youth block has no own site-lead duty (Pitch and equipment setup, Post-event cleaning)
PASS  linked cover with no confirmed lead is shown as at risk (not green)
PASS  templates page lists T01–T09
PASS  templates: no horizontal scroll at 375px
PASS  admin can open settings
PASS  settings: no horizontal scroll at 375px
PASS  coordinator is refused admin settings (server redirect)
PASS  coordinator can only create events at Freemens Way (Freemens Way)
PASS  coordinator's venue filter offers only their venue (My venues, Freemens Way)
PASS  coordinator calendar excludes the other venue
PASS  volunteer lands on /rota
PASS  volunteer is refused the organiser area (server redirect)

25/25 checks passed
```

## Unit + database tests (verbatim)
```
 ✓ tests/db/assignments.db.test.ts > self sign-up > open duty → confirmed, writes an outbox message for the volunteer only
 ✓ tests/db/assignments.db.test.ts > self sign-up > approval-required duty → pending_approval, which holds a place
 ✓ tests/db/assignments.db.test.ts > self sign-up > full duty is refused
 ✓ tests/db/assignments.db.test.ts > self sign-up > cannot sign up twice
 ✓ tests/db/assignments.db.test.ts > self sign-up > refused for draft events (not even visible), started duties and sign-up-disabled duties
 ✓ tests/db/assignments.db.test.ts > self sign-up > suspended volunteer cannot sign up
 ✓ tests/db/assignments.db.test.ts > overlap prevention (any venue) > rejects an overlapping duty at the OTHER venue; allows back-to-back
 ✓ tests/db/assignments.db.test.ts > overlap prevention (any venue) > rejects an overlapping duty at the SAME venue
 ✓ tests/db/assignments.db.test.ts > overlap prevention (any venue) > a pending approval also blocks overlapping commitments; cancelled events do not
 ✓ tests/db/assignments.db.test.ts > restricted duties & authorisation expiry > restricted duty needs a valid authorisation
 ✓ tests/db/assignments.db.test.ts > restricted duties & authorisation expiry > an authorisation that expires before the shift ends does not count
 ✓ tests/db/assignments.db.test.ts > restricted duties & authorisation expiry > composite site-lead shift needs EVERY restricted included duty (agreed Q4)
 ✓ tests/db/assignments.db.test.ts > restricted duties & authorisation expiry > composite responsibilities count once: one slot, one headcount
 ✓ tests/db/assignments.db.test.ts > restricted duties & authorisation expiry > only an admin can grant authorisations; volunteers cannot self-authorise
 ✓ tests/db/assignments.db.test.ts > invitations > an invitation reserves no place; acceptance re-checks capacity
 ✓ tests/db/assignments.db.test.ts > invitations > accept → confirmed; decline → declined; only the invitee can respond
 ✓ tests/db/assignments.db.test.ts > invitations > accepting an approval-required duty goes to pending_approval, never straight to confirmed
 ✓ tests/db/assignments.db.test.ts > invitations > cannot invite someone lacking the authorisation
 ✓ tests/db/assignments.db.test.ts > approvals > coordinator approves/rejects at their venue only; volunteers cannot approve
 ✓ tests/db/assignments.db.test.ts > withdrawal and late cancellation > withdraw before the 24h cutoff frees the place
 ✓ tests/db/assignments.db.test.ts > withdrawal and late cancellation > inside the cutoff: withdraw refused, a cancellation request keeps cover until an organiser acts
 ✓ tests/db/assignments.db.test.ts > withdrawal and late cancellation > the cutoff is configurable
 ✓ tests/db/assignments.db.test.ts > withdrawal and late cancellation > organiser removal needs a reason
 ✓ tests/db/assignments.db.test.ts > event cancellation > cancels event, shifts and active assignments; notifies; suppresses reminders; keeps history
 ✓ tests/db/assignments.db.test.ts > event cancellation > a coordinator cannot cancel another venue's event
 ✓ tests/db/assignments.db.test.ts > time changes > rescheduling moves shifts, resets commitments to invited, frees pending places, and notifies
 ✓ tests/db/assignments.db.test.ts > time changes > template-anchored shifts re-anchor to the new start/end
 ✓ tests/db/assignments.db.test.ts > time changes > update_shift: lowering headcount below committed volunteers is refused; a time change resets
 ✓ tests/db/assignments.db.test.ts > status transitions are enforced centrally > cancelled → confirmed is rejected even for a superuser write
 ✓ tests/db/assignments.db.test.ts > status transitions are enforced centrally > confirmed → pending_approval is rejected even for a superuser write
 ✓ tests/db/assignments.db.test.ts > status transitions are enforced centrally > confirmed → declined is rejected even for a superuser write
 ✓ tests/db/assignments.db.test.ts > status transitions are enforced centrally > declined → withdrawn is rejected even for a superuser write
 ✓ tests/db/assignments.db.test.ts > status transitions are enforced centrally > new assignments cannot start in a finished state; cannot move to another person
 ✓ tests/db/assignments.db.test.ts > attendance and completion > attendance only for confirmed volunteers once the duty has started; complete after the end
 ✓ tests/db/assignments.db.test.ts > access administration > only admins change roles; the last active admin cannot be removed or demoted
 ✓ tests/db/assignments.db.test.ts > access administration > every assignment change is audited without contact details
 ✓ tests/db/concurrency.db.test.ts > last place, two people at the same moment > interleaved: B waits for A's lock, then gets shift_full
 ✓ tests/db/concurrency.db.test.ts > last place, two people at the same moment > burst: 12 volunteers race for 3 places → exactly 3 succeed
 ✓ tests/db/concurrency.db.test.ts > last place, two people at the same moment > two invitees accept the last place at once → exactly one succeeds
 ✓ tests/db/concurrency.db.test.ts > same person, two tabs, overlapping duties > interleaved across venues: second tab blocks on the volunteer lock, then gets overlap
 ✓ tests/db/concurrency.db.test.ts > same person, two tabs, overlapping duties > burst: 6 overlapping duties attempted at once → exactly one
 ✓ tests/db/concurrency.db.test.ts > organiser changes capacity during sign-up > sign-up first, then lowering capacity → below_committed (no one silently dropped)
 ✓ tests/db/concurrency.db.test.ts > organiser changes capacity during sign-up > capacity lowered first, then sign-up → shift_full (no overbooking)
 ✓ tests/db/concurrency.db.test.ts > organiser changes capacity during sign-up > event cancelled while a sign-up is in flight → the new sign-up is cancelled too
 ✓ tests/db/templates.db.test.ts > seeded templates match the catalogue > T01 items are exactly as specified
 ✓ tests/db/templates.db.test.ts > seeded templates match the catalogue > T02 items are exactly as specified
 ✓ tests/db/templates.db.test.ts > seeded templates match the catalogue > T03 items are exactly as specified
 ✓ tests/db/templates.db.test.ts > seeded templates match the catalogue > T09 items are exactly as specified
 ✓ tests/db/templates.db.test.ts > seeded templates match the catalogue > default core slot counts per template match the catalogue
 ✓ tests/db/templates.db.test.ts > seeded templates match the catalogue > exactly nine templates; T01/T02 Marke Wood only, T03/T04 Freemens Way only, the rest either venue
 ✓ tests/db/templates.db.test.ts > seeded templates match the catalogue > re-running the template seed changes nothing and keeps admin edits
 ✓ tests/db/templates.db.test.ts > required acceptance assertions > T01 with gate + tea bar enabled creates FIVE shift rows and EIGHT slots; open/check/lock are included, not rows
 ✓ tests/db/templates.db.test.ts > required acceptance assertions > T03 linked to venue cover with a CONFIRMED site lead creates no site-lead row
 ✓ tests/db/templates.db.test.ts > required acceptance assertions > T09 creates ONE composite site-lead row by default
 ✓ tests/db/templates.db.test.ts > required acceptance assertions > disabled optional roles produce no rows and no vacancies
 ✓ tests/db/templates.db.test.ts > template application > T03 NOT linked creates its own site-lead row (fallback), and can then be published
 ✓ tests/db/templates.db.test.ts > template application > T05 training: nothing by default, so publishing is blocked until a site-cover decision is made
 ✓ tests/db/templates.db.test.ts > template application > applying a template twice never duplicates rows (idempotent)
 ✓ tests/db/templates.db.test.ts > template application > venue-specific templates cannot be used at the other venue
 ✓ tests/db/templates.db.test.ts > template application > creation is atomic: a bad template choice leaves no half-made event
 ✓ tests/db/templates.db.test.ts > template application > only managers of the venue can create events; volunteers cannot
 ✓ tests/db/templates.db.test.ts > template application > the app cannot mark an event as demo (that would silently suppress emails)
 ✓ tests/db/templates.db.test.ts > linking venue cover later removes duplicate lead vacancies (never people) > an uncommitted generated lead row is removed on link; a committed one is kept and reported
 ✓ tests/db/templates.db.test.ts > linking venue cover later removes duplicate lead vacancies (never people) > multiple fixtures can link to one venue-wide cover event
 ✓ tests/db/templates.db.test.ts > the on-screen preview matches what the database creates > T01 (all duties enabled, incl. a DST-crossing window)
 ✓ tests/db/templates.db.test.ts > the on-screen preview matches what the database creates > T02 (all duties enabled, incl. a DST-crossing window)
 ✓ tests/db/templates.db.test.ts > the on-screen preview matches what the database creates > T03 (all duties enabled, incl. a DST-crossing window)
 ✓ tests/db/templates.db.test.ts > the on-screen preview matches what the database creates > T04 (all duties enabled, incl. a DST-crossing window)
 ✓ tests/db/templates.db.test.ts > the on-screen preview matches what the database creates > T05 (all duties enabled, incl. a DST-crossing window)
 ✓ tests/db/templates.db.test.ts > the on-screen preview matches what the database creates > T06 (all duties enabled, incl. a DST-crossing window)
 ✓ tests/db/templates.db.test.ts > the on-screen preview matches what the database creates > T07 (all duties enabled, incl. a DST-crossing window)
 ✓ tests/db/templates.db.test.ts > the on-screen preview matches what the database creates > T08 (all duties enabled, incl. a DST-crossing window)
 ✓ tests/db/templates.db.test.ts > the on-screen preview matches what the database creates > T09 (all duties enabled, incl. a DST-crossing window)
 ✓ tests/db/coverage.db.test.ts > coverage links: same venue, no cycles > rejects a link to another venue, to a non-coverage event, to itself, and from a coverage event
 ✓ tests/db/coverage.db.test.ts > coverage links: same venue, no cycles > a coverage event with dependents cannot change venue or type
 ✓ tests/db/coverage.db.test.ts > coverage links: same venue, no cycles > a coordinator's link edit is validated the same way (and only via the RPC)
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > Catalogue §6: confirmed authorised lead 08:00–14:00 covers both linked activities
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > linking alone is NOT cover: unconfirmed or invited lead → at risk with the full window as a gap
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > lead cancels → BOTH linked activities at risk, organisers alerted; their own duties untouched
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > cancelling the coverage event alerts organisers of every linked event
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > a lead covering only part of the window leaves a reported gap
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > split handover with no gap is covered; with a gap it is not
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > a confirmed lead whose authorisation lapses no longer counts
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > a confirmed lead who is suspended no longer counts
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > no link and no lead shift → no_cover
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > provider-verified cover is a distinct state (and admin-only, with a reason)
 ✓ tests/db/coverage.db.test.ts > full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning) > not_required / no site responsibility
 ✓ tests/db/coverage.db.test.ts > publishing requires an explicit site-cover decision > blocked when the club is responsible and there is no lead shift, link or recorded decision
 ✓ tests/db/coverage.db.test.ts > publishing requires an explicit site-cover decision > allowed with its own site-lead shift
 ✓ tests/db/coverage.db.test.ts > publishing requires an explicit site-cover decision > allowed when linked to venue cover (T03 pattern: no duplicate site-lead row needed)
 ✓ tests/db/coverage.db.test.ts > publishing requires an explicit site-cover decision > allowed when an admin records provider cover or not-required
 ✓ tests/db/coverage.db.test.ts > publishing requires an explicit site-cover decision > allowed when the club is not responsible for the site
 ✓ tests/db/coverage.db.test.ts > publishing requires an explicit site-cover decision > an event with no duties cannot be published
 ✓ tests/db/coverage.db.test.ts > overlapping events at one venue > events may overlap at the same venue and at both venues at once
 ✓ tests/db/coverage.db.test.ts > demo data never sends email > outbox rows for demo events are created as suppressed
 ✓ tests/db/coverage.db.test.ts > misc integrity > rejects invalid intervals, zero headcount and a responsibility repeating the primary duty
 ✓ tests/db/coverage.db.test.ts > misc integrity > a shift may start before and end after its event (but within 24h)
 ✓ tests/db/coverage.db.test.ts > misc integrity > cross-midnight shifts are valid
 ✓ tests/db/coverage.db.test.ts > misc integrity > seedAssignment helper still respects history: no deletes are possible for organisers
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read venues
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read teams
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read volunteers
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read coordinator_venues
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read duty_types
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read volunteer_duty_authorisations
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read duty_templates
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read duty_template_items
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read template_item_responsibilities
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read events
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read event_shifts
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read event_shift_responsibilities
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read assignments
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read cancellation_requests
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read notification_outbox
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read audit_log
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot read club_settings
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > anon cannot call any RPC
 ✓ tests/db/permissions.db.test.ts > anonymous visitors > every application table has RLS enabled
 ✓ tests/db/permissions.db.test.ts > suspended accounts > a suspended volunteer reads nothing from venues
 ✓ tests/db/permissions.db.test.ts > suspended accounts > a suspended volunteer reads nothing from events
 ✓ tests/db/permissions.db.test.ts > suspended accounts > a suspended volunteer reads nothing from event_shifts
 ✓ tests/db/permissions.db.test.ts > suspended accounts > a suspended volunteer reads nothing from assignments
 ✓ tests/db/permissions.db.test.ts > suspended accounts > a suspended volunteer reads nothing from duty_types
 ✓ tests/db/permissions.db.test.ts > suspended accounts > a suspended volunteer reads nothing from club_settings
 ✓ tests/db/permissions.db.test.ts > suspended accounts > a suspended volunteer reads nothing from volunteers
 ✓ tests/db/permissions.db.test.ts > volunteers > see published events at both venues, never drafts
 ✓ tests/db/permissions.db.test.ts > volunteers > see only their own assignments
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot read anyone else's email or phone
 ✓ tests/db/permissions.db.test.ts > volunteers > roster shows NAMES only, and only on a published event they are on
 ✓ tests/db/permissions.db.test.ts > volunteers > staffing counts are visible but invited counts are hidden from volunteers
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot insert an assignment directly
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot update an assignment status directly
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot change events
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot change event_shifts
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot change venues
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot change duty_types
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot change club_settings
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot read the audit log, the outbox, or others' authorisations
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot see templates (organiser tool)
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot call organiser RPCs (forged calls fail)
 ✓ tests/db/permissions.db.test.ts > volunteers > cannot call internal helper functions
 ✓ tests/db/permissions.db.test.ts > coordinators (venue-scoped) > see drafts at their venue only
 ✓ tests/db/permissions.db.test.ts > coordinators (venue-scoped) > see all assignments at their venue, none elsewhere
 ✓ tests/db/permissions.db.test.ts > coordinators (venue-scoped) > see contact details only for volunteers assigned at their venue
 ✓ tests/db/permissions.db.test.ts > coordinators (venue-scoped) > can create a DRAFT event at their venue but not at the other venue, nor create it published
 ✓ tests/db/permissions.db.test.ts > coordinators (venue-scoped) > cannot edit another venue's event, nor change times/status directly
 ✓ tests/db/permissions.db.test.ts > coordinators (venue-scoped) > cannot change roles, venue scopes, authorisations or templates
 ✓ tests/db/permissions.db.test.ts > coordinators (venue-scoped) > allocate / cancel / coverage only at their venue
 ✓ tests/db/permissions.db.test.ts > admins > see everything, including drafts at both venues and the audit log
 ✓ tests/db/permissions.db.test.ts > admins > can manage venues, teams and coordinator scopes directly
 ✓ tests/db/permissions.db.test.ts > admins > still cannot read the outbox from the app (server worker only)
 ✓ tests/db/permissions.db.test.ts > own profile > a volunteer can set their own phone and preferred venue, not their role
 ✓ tests/db/demo-seed.db.test.ts > dev-only DEMO seed > loads cleanly; every event is flagged demo and labelled DEMO
 ✓ tests/db/demo-seed.db.test.ts > dev-only DEMO seed > models shared venue cover without duplicate site leads, and overlapping events
 ✓ tests/db/demo-seed.db.test.ts > dev-only DEMO seed > refuses to load into a database that already has real (non-demo) events
 ✓ tests/db/volunteers-foundation.db.test.ts > account linking (invite-only) > links an invited, active volunteer by verified email (case-insensitive)
 ✓ tests/db/volunteers-foundation.db.test.ts > account linking (invite-only) > refuses an Auth user with no volunteer row (uninvited)
 ✓ tests/db/volunteers-foundation.db.test.ts > account linking (invite-only) > refuses a volunteer row that was never invited
 ✓ tests/db/volunteers-foundation.db.test.ts > account linking (invite-only) > refuses a suspended (inactive) volunteer and does not link
 ✓ tests/db/volunteers-foundation.db.test.ts > account linking (invite-only) > refuses an unverified email
 ✓ tests/db/volunteers-foundation.db.test.ts > account linking (invite-only) > never re-points a row already linked to a different Auth user
 ✓ tests/db/volunteers-foundation.db.test.ts > account linking (invite-only) > anon cannot call the linking function
 ✓ tests/db/volunteers-foundation.db.test.ts > account linking (invite-only) > takes no client-supplied volunteer id
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > anon reads nothing
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > a volunteer sees only their own row (no other emails or phones)
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > an admin sees all rows
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > a suspended volunteer cannot read even their own row, and has no role
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > a volunteer can edit their own display name and phone
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > a volunteer cannot change their own role
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > a volunteer cannot change their own is_active
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > a volunteer cannot change their own email
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > a volunteer cannot change their own auth_user_id
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > a volunteer cannot edit someone else's profile (no rows affected)
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > a volunteer cannot insert or delete volunteers
 ✓ tests/db/volunteers-foundation.db.test.ts > row level security on volunteers > current_app_role reflects an active admin
 ✓ tests/db/seed.db.test.ts > reference data seed > seeds exactly the nine catalogue duty types, in catalogue order, with authorisation defaults
 ✓ tests/db/seed.db.test.ts > reference data seed > has no Parking or Steward duty
 ✓ tests/db/seed.db.test.ts > reference data seed > seeds both venues and the single settings row (24h cutoff, reminders on, Europe/London)
 ✓ tests/db/seed.db.test.ts > reference data seed > is idempotent and keyed by code: re-running changes nothing and keeps admin authorisation choices
 ✓ tests/db/seed.db.test.ts > reference data seed > duty codes are unique (cannot add a duplicate)
 ✓ tests/unit/server-enforcement.test.ts > server-side page guards (DAL) > signed-out request → /login
 ✓ tests/unit/server-enforcement.test.ts > server-side page guards (DAL) > forged or expired session (getClaims fails) → /login, even if a row exists
 ✓ tests/unit/server-enforcement.test.ts > server-side page guards (DAL) > signed in but uninvited (no volunteer row) → /no-access
 ✓ tests/unit/server-enforcement.test.ts > server-side page guards (DAL) > suspended volunteer → /no-access on every guard, including an inactive admin
 ✓ tests/unit/server-enforcement.test.ts > server-side page guards (DAL) > volunteer requesting an organiser page → bounced to /rota
 ✓ tests/unit/server-enforcement.test.ts > server-side page guards (DAL) > admin passes the organiser guard
 ✓ tests/unit/server-enforcement.test.ts > server-side page guards (DAL) > loads the row by the VERIFIED session subject, never by client input
 ✓ tests/unit/server-enforcement.test.ts > login: request code > never allows Supabase to create an account (shouldCreateUser:false)
 ✓ tests/unit/server-enforcement.test.ts > login: request code > gives the same response for invited and uninvited/failed addresses
 ✓ tests/unit/server-enforcement.test.ts > login: request code > rejects a malformed email without calling Supabase
 ✓ tests/unit/server-enforcement.test.ts > login: verify code > valid code + invited active volunteer → linked and sent home
 ✓ tests/unit/server-enforcement.test.ts > login: verify code > admin lands on /manage
 ✓ tests/unit/server-enforcement.test.ts > login: verify code > link result not_invited → signed out with a no-access message
 ✓ tests/unit/server-enforcement.test.ts > login: verify code > link result inactive → signed out with a no-access message
 ✓ tests/unit/server-enforcement.test.ts > login: verify code > link result unverified → signed out with a no-access message
 ✓ tests/unit/server-enforcement.test.ts > login: verify code > link result conflict → signed out with a no-access message
 ✓ tests/unit/server-enforcement.test.ts > login: verify code > linked but then found inactive → signed out
 ✓ tests/unit/server-enforcement.test.ts > login: verify code > wrong or expired code → stays on code step, no linking attempted
 ✓ tests/unit/server-enforcement.test.ts > login: verify code > loginAction dispatches on intent
 ✓ tests/unit/server-enforcement.test.ts > /auth/callback > valid invite link for an invited volunteer → home
 ✓ tests/unit/server-enforcement.test.ts > /auth/callback > uninvited user arriving by link → signed out, /login?error=access
 ✓ tests/unit/server-enforcement.test.ts > /auth/callback > expired link → /login?error=link
 ✓ tests/unit/server-enforcement.test.ts > /auth/callback > unknown OTP type is refused
 ✓ tests/unit/server-enforcement.test.ts > /auth/callback > ignores an off-site next parameter (no open redirect)
 ✓ tests/unit/london-time.test.ts > UK wall time → instant > winter (GMT = UTC)
 ✓ tests/unit/london-time.test.ts > UK wall time → instant > summer (BST = UTC+1)
 ✓ tests/unit/london-time.test.ts > UK wall time → instant > spring forward: 01:30 on 29 Mar 2026 does not exist
 ✓ tests/unit/london-time.test.ts > UK wall time → instant > fall back: 01:30 on 25 Oct 2026 happens twice → first (BST) occurrence, flagged ambiguous
 ✓ tests/unit/london-time.test.ts > UK wall time → instant > 2027 clock changes (28 Mar, 31 Oct)
 ✓ tests/unit/london-time.test.ts > UK wall time → instant > rejects malformed input
 ✓ tests/unit/london-time.test.ts > UK wall time → instant > round-trips every quarter hour of both 2026 clock-change days
 ✓ tests/unit/london-time.test.ts > event windows > normal afternoon fixture
 ✓ tests/unit/london-time.test.ts > event windows > end before start = runs past midnight
 ✓ tests/unit/london-time.test.ts > event windows > an evening event across the autumn clock change lasts the real elapsed time
 ✓ tests/unit/london-time.test.ts > event windows > explains a start inside the spring-forward gap
 ✓ tests/unit/london-time.test.ts > event windows > rejects > 24 hours and equal times
 ✓ tests/unit/london-time.test.ts > display > formats in UK time with the right zone label
 ✓ tests/unit/london-time.test.ts > display > calendar maths
 ✓ tests/unit/templates.test.ts > expandTemplate > T01 default: 3 rows, 5 slots; site lead carries open/check/lock as included duties
 ✓ tests/unit/templates.test.ts > expandTemplate > T01 with gate and tea bar: exactly 5 rows and 8 slots
 ✓ tests/unit/templates.test.ts > expandTemplate > disabled optional duties produce no rows at all (no phantom vacancies)
 ✓ tests/unit/templates.test.ts > expandTemplate > linked venue cover suppresses the site-lead row (never a duplicate vacancy)
 ✓ tests/unit/templates.test.ts > expandTemplate > before-start and after-end offsets are applied to the right anchor
 ✓ tests/unit/templates.test.ts > expandTemplate > offsets are real elapsed minutes across the spring clock change
 ✓ tests/unit/templates.test.ts > expandTemplate > cross-midnight: cleaning after a late event lands on the next day
 ✓ tests/unit/templates.test.ts > expandTemplate > count overrides and validation
 ✓ tests/unit/templates.test.ts > expandTemplate > flags a duty that would end before it starts
 ✓ tests/unit/templates.test.ts > expandTemplate > does not regenerate items already on the event
 ✓ tests/unit/templates.test.ts > describeOffset > event_start -75 → 1 h 15 min before start
 ✓ tests/unit/templates.test.ts > describeOffset > event_start -45 → 45 min before start
 ✓ tests/unit/templates.test.ts > describeOffset > event_end 45 → 45 min after end
 ✓ tests/unit/templates.test.ts > describeOffset > event_end 0 → at end
 ✓ tests/unit/templates.test.ts > describeOffset > event_start -60 → 1 h before start
 ✓ tests/unit/access.test.ts > decideAccess > signed out when there is no verified session
 ✓ tests/unit/access.test.ts > decideAccess > no access for a signed-in Auth user with no volunteer row (uninvited)
 ✓ tests/unit/access.test.ts > decideAccess > no access for an inactive (suspended) volunteer, whatever their role
 ✓ tests/unit/access.test.ts > decideAccess > volunteer may use volunteer pages but not organiser pages
 ✓ tests/unit/access.test.ts > decideAccess > admin and coordinator may use organiser pages
 ✓ tests/unit/access.test.ts > decideAccess > coordinator is refused admin-only pages
 ✓ tests/unit/access.test.ts > homePathFor / linkAllowsEntry > routes by role
 ✓ tests/unit/access.test.ts > homePathFor / linkAllowsEntry > only linked/already_linked allow entry
 ✓ tests/unit/access.test.ts > safeNextPath (open-redirect protection) > keeps same-site path /rota
 ✓ tests/unit/access.test.ts > safeNextPath (open-redirect protection) > keeps same-site path /rota/abc?x=1
 ✓ tests/unit/access.test.ts > safeNextPath (open-redirect protection) > rejects "https://evil.example"
 ✓ tests/unit/access.test.ts > safeNextPath (open-redirect protection) > rejects "//evil.example"
 ✓ tests/unit/access.test.ts > safeNextPath (open-redirect protection) > rejects "/\\evil.example"
 ✓ tests/unit/access.test.ts > safeNextPath (open-redirect protection) > rejects "javascript:alert(1)"
 ✓ tests/unit/access.test.ts > safeNextPath (open-redirect protection) > rejects ""
 ✓ tests/unit/access.test.ts > safeNextPath (open-redirect protection) > rejects "rota"
 ✓ tests/unit/access.test.ts > safeNextPath (open-redirect protection) > rejects "/\nx"
 ✓ tests/unit/access.test.ts > isPublicPath > only login, auth and no-access are public

 Test Files  12 passed (12)
      Tests  251 passed (251)
```
