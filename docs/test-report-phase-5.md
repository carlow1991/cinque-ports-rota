# Phase 5 test report

**Date:** 17 October 2026 · PostgreSQL 16.15 · Node 22.22 · Next.js 16.4.2 · Vitest 5.0.5 · Playwright 1.56 (375×812, touch)

| Check | Result |
|---|---|
| Lint / Typecheck | ✅ 0 problems / 0 errors |
| Production build | ✅; 0 server errors during all end-to-end runs |
| Unit + database tests | ✅ **290 / 290** (17 files) |
| Organiser phone checks (`phase5-organiser.mts`) | ✅ **47 / 47**, three clean runs |
| Regression: Phase 3 organiser / Phase 4 volunteer checks | ✅ 25 / 25 and 37 / 37 |
| Secret key in browser bundle | ✅ none (scan of `.next/static`) |

## Required Phase 5 assertions
- **Cancelling the venue-wide lead warns every linked fixture.** With a confirmed authorised lead, the linked youth block names them ("Site lead confirmed · via … Saturday operations"). After the lead is removed, **both** linked activities are listed "Site lead missing or at risk" with exact uncovered times, organisers are alerted for **each**, and the fixtures' own duties are untouched. (Database tests cover withdrawal, removal and unrelated changes too.)
- **Provider cover is visually separate from a named volunteer.** It shows "External provider" and "No volunteer is named for provider cover", and the coverage page lists it under its own "Provider cover" label.
- **Counts distinguish confirmed / awaiting approval / invited.** Invitations are shown as "invited (not counted)". A composite site-lead duty is one row and one place (unit test).
- **Conflict tests:** the picker flags clashes and missing authorisation; accepting a clashing invitation is refused; approving a request that clashes is refused with organiser wording.
- **Permission tests:** a Freemens Way coordinator sees no Marke Wood items in Needs action, the roster or the printed rota, can't open another venue's invite page, and gets a read-only volunteer list with no access controls. Volunteers are turned away from every organiser page. Only admins can add people, change access, set venues or grant authorisations (database tests).

## Defects found and fixed in Phase 5
1. **Missing alert (spec gap):** losing a venue-wide lead only alerted organisers when the whole cover event was cancelled or moved. A database trigger now alerts every linked event whenever a confirmed lead stops being confirmed.
2. **Needs-action lists were empty:** the loader read the wrong column names. Fixed and covered by the phone checks.
3. **Confirmations vanished after postpone or cancel** (their panels disappear). The event's status banner now says what happened and what to do next.
4. **Confusing wording** when an organiser's approval was refused ("You already have a duty…"). It now says "This volunteer…".
5. An event marked "No site lead needed" showed a red "No site lead yet". It's now hidden when no lead is required.
6. Invalid HTML (links inside a description list) on the dashboard is now a proper list.

## Organiser phone checks (verbatim)
```
PASS  needs-action lists a late cancellation with its reason
PASS  needs-action lists the approval request
PASS  needs-action lists unanswered invitations (not counted as cover)
PASS  needs action: no horizontal scroll at 375px
PASS  approve → confirmed (saved)
PASS  late cancellation accepted → withdrawn, place reopened
PASS  picker flags a clash for someone already on duty then
PASS  picker flags missing authorisation and offers no invite
PASS  invite page: no horizontal scroll at 375px
PASS  invite → 'invited' (not counted as cover)
PASS  volunteer accepts → confirmed
PASS  event page lists people per duty with status in words
PASS  organisers see phone numbers of people on their duties
PASS  event page: no horizontal scroll at 375px
PASS  attendance marked present (saved)
PASS  event completed after its end
PASS  postpone → event postponed and the volunteer reset to 'invited'
PASS  postponement queued a message to the volunteer
PASS  volunteer sees the postponement and is asked to respond
PASS  volunteer reconfirms → confirmed again
PASS  volunteer is warned their duty was cancelled, with the reason
PASS  with a confirmed venue lead, linked fixtures are not flagged
PASS  linked fixture names the confirmed venue lead
PASS  lead removed → BOTH linked activities listed as site lead at risk
PASS  organisers alerted for every linked event (DEMO Additional club activity, DEMO U7/U9 youth fixture block)
PASS  the fixtures' own duties are unchanged
PASS  coverage: no horizontal scroll at 375px
PASS  provider cover is labelled as such, not as a named volunteer
PASS  coverage page lists provider cover separately
PASS  coverage shows confirmed/required and open places per duty
PASS  expected-on-site chart is a real table with numbers (readable without colour) (peak 2)
PASS  print rota lists both venues, open places and the site-lead warning
PASS  print hides the app header and menus
PASS  admin adds and invites a volunteer
PASS  the invited volunteer can sign in
PASS  admin grants a dated club authorisation
PASS  admin suspends a volunteer
PASS  volunteers: no horizontal scroll at 375px
PASS  coordinator's needs-action excludes the other venue
PASS  coordinator cannot open the invite page for another venue's duty
PASS  coordinator sees no 'Add a volunteer' and no access controls
PASS  coordinator sees only people on their venue's duties (Val is only on Marke Wood duties)
PASS  coordinator's printed rota excludes the other venue
PASS  volunteer is turned away from /manage/coverage
PASS  volunteer is turned away from /manage/approvals
PASS  volunteer is turned away from /manage/volunteers
PASS  volunteer is turned away from /manage/coverage/print

47/47 checks passed
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
 ✓ tests/db/organiser.db.test.ts > manage_roster > is venue-scoped: a coordinator sees only their venue's people
 ✓ tests/db/organiser.db.test.ts > manage_roster > includes phone for organisers (Q10), never email
 ✓ tests/db/organiser.db.test.ts > manage_roster > lists empty duties once so a printed rota shows unfilled places
 ✓ tests/db/organiser.db.test.ts > manage_roster > admins see both venues; volunteers see nothing
 ✓ tests/db/organiser.db.test.ts > manage_roster > a single event can be requested, still scoped
 ✓ tests/db/organiser.db.test.ts > manage_action_queue > collects approvals, invitations and cancellation requests for the caller's venues only
 ✓ tests/db/organiser.db.test.ts > conflicts on allocation > an invitation never reserves a place, and accepting a clashing invitation is refused
 ✓ tests/db/organiser.db.test.ts > event_cover_leads > names the confirmed lead on the linked cover event and flags lost authorisation
 ✓ tests/db/organiser.db.test.ts > admin volunteer management > only admins add volunteers; email is normalised; re-adding updates instead of duplicating
 ✓ tests/db/organiser.db.test.ts > admin volunteer management > re-inviting cannot demote the last admin
 ✓ tests/db/organiser.db.test.ts > admin volunteer management > coordinator venues are replaced atomically and only for coordinators
 ✓ tests/db/organiser.db.test.ts > losing the venue-wide lead alerts organisers of every linked event (Catalogue §7.8) > lead withdraws
 ✓ tests/db/organiser.db.test.ts > losing the venue-wide lead alerts organisers of every linked event (Catalogue §7.8) > organiser removes the lead
 ✓ tests/db/organiser.db.test.ts > losing the venue-wide lead alerts organisers of every linked event (Catalogue §7.8) > other duties changing do NOT raise venue alerts
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
 ✓ tests/db/volunteer-views.db.test.ts > volunteer_rota > lists only upcoming PUBLISHED events, never drafts or past ones
 ✓ tests/db/volunteer-views.db.test.ts > volunteer_rota > counts open sign-up places and the ones I can actually take
 ✓ tests/db/volunteer-views.db.test.ts > volunteer_rota > venue filter
 ✓ tests/db/volunteer-views.db.test.ts > volunteer_rota > returns nothing to suspended or anonymous callers
 ✓ tests/db/volunteer-views.db.test.ts > volunteer_event_view > explains why I can't take a duty: authorisation (by duty name) and clashes
 ✓ tests/db/volunteer-views.db.test.ts > volunteer_event_view > returns counts only: no other volunteer's id, name, email or phone anywhere
 ✓ tests/db/volunteer-views.db.test.ts > volunteer_event_view > shows my own status after signing up; authorisation lets me see the lead as available
 ✓ tests/db/volunteer-views.db.test.ts > volunteer_event_view > draft events are invisible to volunteers
 ✓ tests/db/volunteer-views.db.test.ts > volunteer_event_view > organiser-allocated duties are listed but marked not open for sign-up
 ✓ tests/db/volunteer-views.db.test.ts > my_duties > returns only my rows, including past ones with attendance, and the withdrawal deadline
 ✓ tests/db/volunteer-views.db.test.ts > my_duties > an invitation appears with source admin_allocation; cancelled events keep their reason
 ✓ tests/db/volunteer-views.db.test.ts > my_duties > shows a pending late-cancellation request
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
 ✓ tests/db/demo-seed.db.test.ts > dev-only DEMO seed > loads cleanly; every event is flagged demo and labelled DEMO
 ✓ tests/db/demo-seed.db.test.ts > dev-only DEMO seed > models shared venue cover without duplicate site leads, and overlapping events
 ✓ tests/db/demo-seed.db.test.ts > dev-only DEMO seed > refuses to load into a database that already has real (non-demo) events
 ✓ tests/db/seed.db.test.ts > reference data seed > seeds exactly the nine catalogue duty types, in catalogue order, with authorisation defaults
 ✓ tests/db/seed.db.test.ts > reference data seed > has no Parking or Steward duty
 ✓ tests/db/seed.db.test.ts > reference data seed > seeds both venues and the single settings row (24h cutoff, reminders on, Europe/London)
 ✓ tests/db/seed.db.test.ts > reference data seed > is idempotent and keyed by code: re-running changes nothing and keeps admin authorisation choices
 ✓ tests/db/seed.db.test.ts > reference data seed > duty codes are unique (cannot add a duplicate)
 ✓ tests/db/privileges.db.test.ts > function privileges > anonymous visitors can execute NO function in the public schema
 ✓ tests/db/privileges.db.test.ts > function privileges > signed-in users can execute exactly the allow-list (no internal helpers)
 ✓ tests/db/privileges.db.test.ts > function privileges > internal helpers stay uncallable
 ✓ tests/db/privileges.db.test.ts > function privileges > a function created later does not become callable by anon (default privilege removed)
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
 ✓ tests/unit/staffing.test.ts > staffingByShift > counts confirmed, pending (holds a place) and invited (does not) separately
 ✓ tests/unit/staffing.test.ts > staffingByShift > a composite site-lead duty is ONE row and ONE place, however many responsibilities it has
 ✓ tests/unit/staffing.test.ts > expectedOnSite > counts unique confirmed people per slot; back-to-back duties by one person count once
 ✓ tests/unit/staffing.test.ts > expectedOnSite > ignores other venues and unconfirmed people; empty when nobody is confirmed
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
 ✓ tests/unit/volunteer-helpers.test.ts > groupMyDuties > splits into tabs; an in-progress duty is still 'confirmed', not past
 ✓ tests/unit/volunteer-helpers.test.ts > groupMyDuties > surfaces only RECENT cancellations of upcoming duties; declined/withdrawn are not alerts
 ✓ tests/unit/volunteer-helpers.test.ts > groupMyDuties > opens on invitations when any are waiting
 ✓ tests/unit/volunteer-helpers.test.ts > calendar file > escapes text and writes UTC times
 ✓ tests/unit/volunteer-helpers.test.ts > calendar file > folds long lines

 Test Files  17 passed (17)
      Tests  290 passed (290)
```
