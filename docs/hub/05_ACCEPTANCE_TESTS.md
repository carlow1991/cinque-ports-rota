# 05 — Acceptance Tests & QA (build automated tests where applicable)

Classification: **C** critical for go-live; **H** high-value; **P** polish. Claude must map each to automated unit/integration/E2E tests, using existing test tooling when suitable. Use anonymised test records and a staging email sandbox.

## People, identity and permissions
- **C01** Admin creates Scott with name only, Manager involvement, no email, portal invitation OFF, routine requests OFF. Record persists; no auth account/email is created.
- **C02** Admin creates Kelly with contact, routine availability enabled, invitation OFF; no message is sent. Admin later sends an explicit portal invite; send once and audit.
- **C03** An unauthorised member cannot edit another person's details or retrieve private contact info via direct API call/URL.
- **C04** Person linked to auth account does not create duplicate person row. A person may hold 8+ club posts and appear in many teams.
- **C05** Public cannot view private club directory/calendar using guessed URLs, API endpoints or DB anon key.
- **H06** Invite send failure remains visible as `not sent`/`failed` with retry; no false success state.
- **H07** Admin creates manager expected-at-team-events; no availability emails automatically sent for that manager.

## Calendar and minimal event entry
- **C08** Admin creates `Mini Kickers`, Marke Wood, Saturday 09:00–11:00, information-only, in one short form; calendar displays it without volunteer button.
- **C09** Admin creates `Youth Home Fixtures` 09:00–12:00 and Veterans game kickoff 10:30. All three events appear independently on Saturday agenda without collisions/merging.
- **C10** Away Ladies fixture at free-text external location appears on calendar without creating a venue or requiring volunteers.
- **C11** Freemens Way remains stored inactive and its historic events remain viewable; inactive venue excluded from ordinary new event selection.
- **C12** Kickoff-only event with no end shows 'finish unknown'; app does not infer full café/venue overlap or invent finish time.
- **H13** Event copied as new draft has prefilled fields but independent identity and does not copy invitations/responses/cover.
- **C14** Material reschedule flags relevant confirmed assignments as needing reconfirmation and suppresses outdated reminders; cancelled event retains history.
- **H15** Europe/London DST change correctly stores/represents instants; invalid/nonexistent local wall-clock times handled explicitly.

## Availability and event assignments
- **C16** Volunteer chooses Yes → Full event and response is saved uniquely; changes to No, with current response updated and old change auditable.
- **C17** Volunteer chooses Yes → specific available times; server rejects invalid times and handles unknown event end correctly.
- **C18** Only explicitly requested people show as Not replied. Other people are Not asked; no bulk email simply by publishing event.
- **C19** Admin requests availability from Kelly, Adam, Riley, Bob and Steve after reviewing recipient selection; Scott, Danny, Matty remain unrequested unless selected manually.
- **C20** Bob gets direct request for Ladies fixture and confirms; only now is he shown Confirmed (not when invited or when Yes on availability).
- **C21** Steve declines; he appears Declined and organiser can ask another volunteer. Events/other assignments unchanged.
- **C22** Admin records an offline phone reply for no-login volunteer; source is `Recorded by organiser`, not `Confirmed online`.
- **C23** Manager associated with event's team appears under Expected by role, never under confirmed by default; a one-off absence override affects only that event.
- **C24** One-off direct invitation to manager with routine requests OFF is possible via explicit admin action.
- **H25** Multiple clicks on Confirm/Send don't duplicate current response, assignment or email.

## Shared venue cover and overlap
- **C26** Kelly has one **venue-wide** café assignment at Marke Wood 09:00–13:00, state Confirmed. Mini Kickers 09:00–11:00, Youth 09:00–12:00, Veterans 10:30–13:00 all show contextual café cover. DB has **one** assignment, not three.
- **C27** Venue/day summary counts Kelly once; event-specific views do not include a cloned event assignment for Kelly.
- **C28** Changing Kelly's end to 11:00 changes overlap labels; cancellation removes coverage from all derived event views without editing each event.
- **C29** Simultaneous events at different venues do not get mixed venue cover.
- **C30** If two assignments genuinely require the same person in two different places at same time, a visible conflict warning occurs; admin must resolve/record override. Same-venue shared café cover across concurrent events is **not** rejected.
- **C31** For event with unknown end, UI may show 'café cover at kickoff' but not claim cover for full event.
- **H32** Admin assigns a different person to unlock vs lock; these are two clean venue assignments, not mandatory fixture sub-shifts.

## Club positions and applicants
- **C33** Carl appears as current holder of multiple example roles; Club Secretary can be `Filled` AND `Seeking replacement` simultaneously. Another filled role can be `Additional help wanted`.
- **C34** A shared position can have two active holders, with recruitment flags independent. Historic holder dates remain correct after succession.
- **C35** Published opportunities show public-safe role copy, not full internal records or private contacts.
- **C36** Public applicant (no login) submits name, a contact method, interests including `I'm not sure`, strengths, daypart availability, monthly commitment and privacy acknowledgement; record available in secure admin inbox.
- **C37** Public applicant does not get Supabase Auth account, directory login, automatic club role assignment, or portal invite.
- **C38** Anonymous actor cannot SELECT or change applications, people, positions/holder private fields, assignments, audit or email queue, even using direct requests.
- **C39** Existing matching email/phone surfaces possible duplicate for review; no automatic merge/overwrite.
- **C40** Role suggestions explain matched interests/skills/time; unsuitable/FA-restricted role is flagged for human review. No automatic hiring decision.
- **C41** Application with invalid contact or missing privacy acknowledgement rejects safely; rate limit/bot controls respond without exposing data.
- **C42** Public under-18 selection diverts to agreed youth enquiry process without collecting personal details through the adult form.
- **H43** Admin records applicant follow-up, potential position and trial/shadowing without giving them portal access.
- **H44** Application export/deletion and retention workflow work according to configured approved club policy.

## UI / usability / operations
- **C45** Mobile event creation shows only essential fields before advanced expander; no nine-duty template wizard or required staffing matrix.
- **C46** Volunteer sees an invitation and can Confirm/Decline in a small number of clear interactions.
- **C47** Admin weekend screen distinguishes Available vs Confirmed vs Expected vs Pending/Declined; no inaccurate count or badge.
- **H48** Keyboard and screen-reader accessible for calendar, volunteer form, admin event edit; responsive at 320px width and 200% zoom.
- **C49** All tables with private data protected with RLS and server checks; service key not exposed to frontend environment.
- **C50** Notifications only send following explicit intended admin action, not from person creation, event creation, application submission portal invite or routine roster sync. Transactional acknowledgement, if implemented, is separately configured and not an access invitation.
- **C51** Staging data migration preserves old volunteer IDs/history and can be rolled back; production untouched before approval.
- **H52** Email outbox idempotency, failures and retry supported without duplicate notifications.

## Demo script owner can run in staging
1. Add Scott with no login; link as team manager (no availability requests).
2. Add Kelly as volunteer; invite her (explicitly) and enable routine-request suggestions.
3. Add Saturday Mini Kickers, Youth Fixtures and Veterans fixture, overlapping at Marke Wood.
4. Assign Kelly café 09:00–13:00 once; confirm it; verify all three events show coverage and admin summary shows one person.
5. Add Ladies fixture next day, invite Bob and Steve manually. Bob confirms, Steve declines.
6. Add an away meeting information-only, confirm no availability controls.
7. Create occupied Club Secretary and Groundsman roles; flag replacement for one, extra support for the other.
8. Open private/incognito public Apply form, submit a new applicant with broad interests/strengths/daypart commitments.
9. Verify applicant appears only in admin inbox, can be reviewed and matched; no login created, no invitation sent.
10. Review weekend dashboard for accurate statuses and check Freemens Way is inactive.
