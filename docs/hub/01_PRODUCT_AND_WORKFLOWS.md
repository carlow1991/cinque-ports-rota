# 01 — Product Requirements & Workflows
**Product:** Cinque Ports FC Volunteer Hub (supersedes the complex rota)  
**Primary domain:** `rota.cinqueportsfc.co.uk` subject to deployment approval  
**Locale / timezone:** en-GB / Europe-London  
**Primary users:** club admins/coordinators, invited volunteers/officials; general public only on opportunities and application pages.

## 1. Product definition
Make it easy to answer: **What's on? Who is expected? Who has offered availability? Who has actually accepted a responsibility? Who do I contact? Where do we need replacements or help?**

Success criteria: add an ordinary event using five essential fields; available volunteer can respond Yes/No and (if necessary) supply times in fewer than four actions; admin can create a person without sending anything; admin can see a weekend overview of all overlapping club activities without duplicate café/site cover; public applicant completes a short, safe form without login; existing filled roles can be advertised for successors.

## 2. Personas / privacy boundaries
- **Public visitor**: sees approved, published recruitment opportunities and a simple application form. No private directory/calendar details unless expressly marked public. No account.
- **Person record without account**: tracked in directory; cannot log in; no email or request sent unless admin explicitly initiates; admin may record spoken/phone responses with attribution.
- **Portal member (volunteer or manager)**: sees published internal club calendar, their own invitations/commitments, limited club contact details/position listings and profile; can respond to event requests and update own information.
- **Coordinator**: manages assigned scope (team and/or venue) and events/assignments; can see relevant operational contact details; cannot manage user permissions or access unrelated personal data.
- **Admin**: manages people, directory, events, venue cover, club positions, applications and settings. Production access remains protected by least privilege.
- **Official expected by role**: appears on team-linked events without routine availability prompts. May lack login. 'Expected' is distinct from attendance confirmation.

## 3. Navigation
**Logged-in:** Home | Calendar | People | Opportunities | My Profile. Show an additional **Manage** entry for coordinators/admins only.
**Public:** Volunteer Opportunities | Apply to Volunteer | Privacy Notice | Sign In. No internal people directory or internal calendar publicly accessible.
**Admin inside Manage:** Overview | Events | People | Volunteer Requests | Shared Venue Cover | Club Roles | Applications | Settings.
Do not create a sprawling second hierarchy for duties, shifts, approvals or reports.

## 4. People directory — fundamental entity
A person record has name (required), optional email/telephone, optional teams, positions, interests, usual availability and commitment. Portal invitation and routine availability requests are two independent toggles.
- `invite_to_portal` is an **action**, not side-effect of Save Person; display 'Send invitation' button and confirmation if email exists.
- `routine_requests_enabled` is a **preference**, not permission to blast messages automatically. Admin reviews and sends recipient list when requesting availability for an event.
- Many-to-many person↔team memberships; person↔club positions. One person may be vice-chair, secretary, grounds, finance etc.
- Admin may prepopulate people without contact details and link auth user later, ensuring no duplicates.
- Directory has private/admin fields and intentionally shareable club contact cards. Default is no exposure of personal phone/email to all volunteers or the public.
- Under 18 applicants/volunteers must not be inadvertently added to ordinary adult public contact listings; see privacy/safeguarding rules.

## 5. Calendar — one source of truth for all club activities
Event types: match, training, mini kickers, youth activity, meeting, social/fundraiser, maintenance, other. Support venue or free-text external location; team optional; opponent/competition optional for fixtures.
**Minimal Create Event:** title, date, start time, end time (optionally unset for kickoff-only fixture), location/venue. 'Volunteers can respond' optional toggle (default off for information-only). Hidden advanced: team, event type, notes, public/internal visibility, kickoff time distinct from operating window, repeat/duplicate, link to related event, contact.
- Every club event appears internally, including away fixtures and non-volunteer events.
- Events can overlap; do not merge them.
- Venue `Marke Wood` active. Retain `Freemens Way` inactive in DB, admin settings and historical views; exclude from ordinary *new event* venue dropdown until reactivated.
- Admin can set outside/away location text instead of creating a permanent venue.
- Default calendar = clean mobile agenda grouped by day; filter venue/team/type; week view optional. Overlapping events show separate event cards grouped under same day/location.
- An event with only kickoff or unknown end remains visible, but **must not** claim whole-window venue coverage using missing duration.
- Admin can duplicate events or start from last similar event; no large compulsory duty-template wizard.
- Event status draft/published/cancelled/completed. Publication controls visibility, not automatic emails.

## 6. Event availability — response, not a booking
Only when an event accepts availability, an eligible portal member sees **Yes / No**. When Yes: Full event OR Available from–until. No reason required when No. Allow change and history.
- Persist exactly one current response per event/person. Audit changes. Partial times must be valid and within known event window, otherwise flag for admin validation if event end unknown.
- People without logins: admin may enter their Yes/No response and timings, label as `Recorded by [organiser]`, not `Confirmed by person`.
- Non-responders show 'Not replied' only among people deliberately asked, not among everyone in the directory.
- Explicit 'Request availability' flow lets organiser pick recipients; preselect suggestions from `routine_requests_enabled=true` and relevant team/interests, but **requires organiser to press Send**. Do not email every person whenever an event is created or published.
- Event availability is not a confirmed duty, even if Yes.

## 7. Event-specific manual invitations and assignments
Admin opens event > `Invite/Assign person` > search person > optional responsibility (free text or one of nine familiar duties) and optional time range > `Send request` or `Record manually`.
- Request state pending -> accepted/confirmed or declined; cancelling an accepted request changes it to cancelled. If person has no portal access, organiser can contact them offline and manually record 'Confirmed by organiser', with source and timestamp.
- A manually allocated named person should **not** be marked confirmed until they actually agree or organiser records the offline agreement.
- Direct assignment can be issued to someone with `routine_requests_enabled=false` through an explicit one-off action.
- No staffing quotas or mandatory role types. Show optional responsibility label and note.
- For material event changes (date, venue or assigned time), re-request confirmation from affected parties or flag as requiring reconfirmation. Cancelled events retain history and suppress reminders.

## 8. Venue-wide cover (shared across overlapping events)
Create exactly **one** venue assignment for a person with a venue, start/end, optional duty label such as café, and state pending/confirmed/declined/cancelled. It may span multiple events. Example (illustrative): Kelly covers Marke Wood café 09:00–13:00 on a Saturday while Mini Kickers, youth games and Veterans overlap.
- On each event page, show overlapping **confirmed shared venue cover** in its own 'Venue support' section, not copied into event assignments.
- On venue/day schedule, list Kelly once in a 'Shared venue cover' band.
- One person with two compatible roles at same site can exist in source records, but count unique people when presenting people expected. Flag potentially incompatible time overlaps across venues or obligations; do not indiscriminately block all overlap (site lead/café can cover multiple events).
- If shared cover changes or is cancelled, update derived event views immediately; do not create/delete event-specific clones or send one notification per linked fixture.
- Distinguish `cover overlaps some of event` from `covers full event window`; never assert full cover if a fixture's end is unknown.
- Opening/closing duties may be stand-alone venue-wide assignments, not required on every event.

## 9. Expected-by-role presence
Person ↔ team membership has role (manager, coach, etc.), optional `expected_at_team_events` toggle. On a team-linked event, relevant managers are **derived** in 'Expected by role'. They are not asked routine availability unless manually targeted. Their state is **Expected (unconfirmed)** unless an explicit confirmation/absence is recorded.
- Event detail sections, visibly distinct: Expected by role | Confirmed event assignments | Shared venue cover | Available to help | Awaiting response / declined.
- No duplication of person cards when person falls into multiple categories; label multiple involvement badges on one person card if useful.
- Admin can mark team manager unavailable manually for an event without editing the permanent team association.
- Team membership may have effective dates; when manager changes, future events use the appropriate current assignment, and historical events preserve historical responsibility.

## 10. Club roles, vacancies, support and handovers
Each club position has title, department, public description, key responsibilities, estimated time commitment, on-site/remote preference, required vs optional skills, can-train flag, whether role is youth-facing/restricted, recruiting contact and public visibility.
- Occupancy derives from current active `position_holders` (none = vacant, one = filled, >1 = shared), **independent** of recruiting flags.
- Independently, admin can set `seeking_replacement` and/or `seeking_additional_help`, and can publish a vacant post. A post held by Carl can show `Filled — looking for replacement` without removing Carl.
- Person may hold many posts; each post may have many holders. Keep effective start/end and historical role record. Succession pipeline optionally: interested -> discussion -> shadowing -> handover -> successor active, with lightweight notes, not a second HR platform.
- A club official's actual appointment and required external registration / FA safer recruitment remain separate processes; app status does not confer official authority.
- Public opportunities list advertises only intentionally published position descriptions, never private holder contact fields by default.

## 11. Public no-login application
Provide public `/volunteer/apply` in three steps: About you; Your interests/strengths; Time commitment/availability. Store to a secure review inbox with person/lead linking; not to an authenticated member account.
- On submit validate contact method (email OR phone), privacy notice acknowledgement, input length/format. No date of birth, DBS numbers, criminal record, health details, government IDs or sensitive personal data in public form. Set a club-approved pathway for under-18 volunteers separately; by default the V1 public form serves adults and presents a club contact route to young volunteers.
- Capture multiple role interests, `not sure—help me find a role`, strengths, previous experience text (optional), willing to learn/shadow, weekdays/dayparts, monthly commitment bucket, regular/occasional/one-off, remote/on-site/either, preferred communication, club connection, free text.
- Submission creates **a reviewable application in the same database**, visible under People > Applicants; if potential match with a known person, flag duplicate and require admin decision before linking/merging. Do not automatically overwrite directory data.
- Admin statuses: new, reviewing, contacted, trial/shadowing, accepted_to_pool, closed. A submitted application never grants account access, automatically appoints a role, or sends a portal invite.
- Basic deterministic, explainable role recommendations on interests/skills/availability; visible as suggestions only and allow organiser to override. Exclude roles requiring unverified external eligibility from any 'ready to appoint' action.

## 12. Dashboard and priorities
**Member Home:** My next response request | My accepted commitments | Upcoming club events | Browse opportunities. No admin statistics.
**Admin Home:** Next 7 days events (including overlaps); shared venue cover by day; pending direct invitations; requested availability still unanswered; new applications; vacant posts/seeking replacement/support; quick `Add Event` and `Add Person`.
Weekend overview grouped by day and venue; distinguish Expected, Available, Pending and Confirmed. Simple counts are fine but avoid vanity metrics and complicated analytics.

## 13. Communications
Do not replace WhatsApp. Only send transactional email from deliberate, authorised actions: portal invitation, specific availability request, direct assignment request, response/reconfirmation/cancellation, and optionally acknowledgement of public application if a valid email exists and club approves copy. Bulk sending requires recipient review and explicit Send. No unsolicited notifications on creating a person or event.
If email unavailable, admin can copy a message and record contact made manually. Use outbox retries and idempotency keys to avoid duplicates. Record notifications and failures; never leak private directories in messages.

## 14. Former nine duty categories
Retain only as optional tags for interests and responsibility labels: Site lead / duty manager; Open and unlock facilities; Lock and secure facilities; Gate / admission collection; Refreshments / tea bar; Pitch and equipment setup; Changing room / facility checks; Post-event cleaning; General volunteer support. No compulsory rota generation, staffing quotas or templates.

## 15. Explicitly out of scope initially
Payroll, attendance/check-in tracking, full task manager, complex shift staffing engine, points/leaderboards, public roster, broad social messaging, SMS/WhatsApp automations, external fixture feed sync, Carl OS integration, secure DBS document store, detailed match statistics, commercial venue bookings, automated hiring or automatic official appointments.
