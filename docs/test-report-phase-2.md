# Phase 2 test report

**Date:** 16 October 2026 · **Environment:** PostgreSQL 16.15, Node 22.22, Vitest 5.0.5
**Commands:** `npm run lint` · `npm run typecheck` · `npm test`

Database tests run against a **real PostgreSQL 16 server**. Each test file creates a throwaway database and applies all migrations to it, plus a minimal stand-in for Supabase's `auth` schema. They run as the real `anon` and `authenticated` roles with JWT claims, so RLS applies exactly as it does in Supabase. Concurrency tests open a **separate connection per actor**.

## Results

| Check | Result |
|---|---|
| Lint | ✅ 0 problems |
| Typecheck | ✅ 0 errors |
| Tests | ✅ **190 passed / 190** (8 files): 42 unit + 148 database |
| Stability | Database suite re-run 3 extra times: 148/148 each time |
| Mutation check | With the shift lock removed from `self_signup`, 3 race tests **fail** (overbooking detected). Restored: 8/8 pass. |
| Seeds | Applied 3× on one database: still 9 duty types, 2 venues, 1 settings row |

## Defects found by these tests during Phase 2 (fixed)

1. **Coordinators couldn't create a draft at their own venue when the app asked for the new row back** (`INSERT … RETURNING`). The read policy re-looked-up the event by id, which isn't visible within the same statement. The policy now checks the row's own `venue_id` and `status`.
2. **Audit trigger** would have failed on `club_settings`, whose numeric id was being cast to a UUID. It now uses only UUID-shaped keys.
3. Two **test-harness** issues: the clock drifted between rows, and one parameter's type was ambiguous. These were the tests' fault, not the app's, and were fixed so that tests compare exact times as real rota data does.

## Verbatim test output

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
 ✓ tests/db/coverage.db.test.ts > coverage links: same venue, no cycles > rejects a link to another venue, to a non-coverage event, to itself, and from a coverage event
 ✓ tests/db/coverage.db.test.ts > coverage links: same venue, no cycles > a coverage event with dependents cannot change venue or type
 ✓ tests/db/coverage.db.test.ts > coverage links: same venue, no cycles > a coordinator's direct link edit is validated the same way
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

 Test Files  8 passed (8)
      Tests  190 passed (190)
```
