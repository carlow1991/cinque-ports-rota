# Phase 4 test report

**Date:** 17 October 2026 · PostgreSQL 16.15 · Node 22.22 · Next.js 16.4.2 · Vitest 5.0.5 · Playwright 1.56 (Chromium, 375×812, touch)

| Check | Result |
|---|---|
| Lint | ✅ 0 problems |
| Typecheck | ✅ 0 errors |
| Production build | ✅ success; 0 server errors during end-to-end runs |
| Unit + database tests | ✅ **272 / 272** (15 files) |
| Volunteer phone checks (`tests/e2e/phase4-volunteer.mts`) | ✅ **37 / 37**, three clean runs |
| Organiser phone checks (Phase 3, regression) | ✅ **25 / 25** |

## What the phone checks prove
- Sign in → open event → sign up takes **under a minute** (1.5 s automated; 5 taps and 2 fields).
- "Confirmed" appears only after the database has the confirmed row.
- **Lost race:** a place taken by someone else after the page loaded gives "Shift now full; please contact the organiser" and nothing is saved.
- **Privacy:** another volunteer's name appears only after joining the same event. Their email and phone never appear anywhere in the page source.
- Every reason a duty can't be taken is explained in words: full, needs club authorisation, time clash.
- A duty is requested with the **keyboard only**, giving pending approval (place held).
- Accept and decline an invitation; withdraw before the 24h cut-off; inside it, only a cancellation **request** (still confirmed).
- Calendar file for my own duty works; someone else's returns not found. Past duties show attendance.
- Profile validation and save. Each screen has every control labelled and exactly one main heading. No horizontal scrolling at 375px.
- A volunteer suspended mid-session is shut out on the next page load.

## Defects found and fixed in Phase 4
1. **Security:** anonymous visitors could *execute* ten newer database functions (PostgreSQL's default "execute for everyone"). None would act without a signed-in volunteer, but the extra barrier is now in place for every function, enforced by a sweep test.
2. The bottom menu read the page address outside a loading boundary, which broke the production build. Fixed.
3. Test-harness fixes (not app bugs): the stand-in Supabase now keeps a stable signing key between restarts, as real Supabase does; checks wait for streamed content before reading it; the labelling check now looks inside collapsed panels.

## Volunteer phone checks (verbatim)
```
PASS  before joining the event, other volunteers' names are not shown
PASS  sign-in → open event → sign up takes under 1 minute (1.4 s with automation; 5 taps + 2 fields)
PASS  'confirmed' shown only after the database committed it
PASS  event page: no horizontal scroll at 375px
PASS  once on the event, confirmed names are visible
PASS  no other volunteer's email or phone anywhere in the page
PASS  full duty says Full
PASS  restricted duty explains the club authorisation
PASS  clashing duty explains the overlap
PASS  race lost: 'Shift now full; please contact the organiser' (Shift now full; please contact the organiser.)
PASS  nothing was saved for the lost race
PASS  keyboard-only 'Request this duty' → pending approval (place held)
PASS  rota lists published events (sanity: content really loaded)
PASS  rota hides drafts
PASS  rota marks events I'm on, in words not just colour
PASS  rota shows how many places I can take
PASS  rota: no horizontal scroll at 375px
PASS  venue tab filters to that venue (DEMO Freemens Way Saturday operations | DEMO U7/U9 youth fixture block)
PASS  a draft event URL shows 'Not found' and none of its details
PASS  My Duties opens on 'Awaiting response' when invitations wait
PASS  my duties: no horizontal scroll at 375px
PASS  accept → confirmed, decline → declined (saved) ([{"code":"cleaning","status":"declined"},{"code":"refreshments","status":"confirmed"}])
PASS  withdrawal deadline is shown
PASS  withdraw before cut-off → withdrawn, place reopened
PASS  inside cut-off there is no withdraw button
PASS  late cancellation is a pending request; still confirmed until an organiser acts
PASS  calendar file for my duty
PASS  calendar file for someone else's duty → not found
PASS  past duties show attendance
PASS  profile: no horizontal scroll at 375px
PASS  invalid phone gets a plain-English error
PASS  profile saved to the database
PASS  /rota: every control is labelled; exactly one h1
PASS  /rota/6b171bdf-3b11-4d6a-bedf-a464aae1a704: every control is labelled; exactly one h1
PASS  /my-duties: every control is labelled; exactly one h1
PASS  /profile: every control is labelled; exactly one h1
PASS  suspended volunteer is shut out immediately

37/37 checks passed
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
 ✓ tests/db/privileges.db.test.ts > function privileges > anonymous visitors can execute NO function in the public schema
 ✓ tests/db/privileges.db.test.ts > function privileges > signed-in users can execute exactly the allow-list (no internal helpers)
 ✓ tests/db/privileges.db.test.ts > function privileges > internal helpers stay uncallable
 ✓ tests/db/privileges.db.test.ts > function privileges > a function created later does not become callable by anon (default privilege removed)
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
 ✓ tests/unit/volunteer-helpers.test.ts > groupMyDuties > splits into tabs; an in-progress duty is still 'confirmed', not past
 ✓ tests/unit/volunteer-helpers.test.ts > groupMyDuties > surfaces only RECENT cancellations of upcoming duties; declined/withdrawn are not alerts
 ✓ tests/unit/volunteer-helpers.test.ts > groupMyDuties > opens on invitations when any are waiting
 ✓ tests/unit/volunteer-helpers.test.ts > calendar file > escapes text and writes UTC times
 ✓ tests/unit/volunteer-helpers.test.ts > calendar file > folds long lines
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

 Test Files  15 passed (15)
      Tests  272 passed (272)
```
