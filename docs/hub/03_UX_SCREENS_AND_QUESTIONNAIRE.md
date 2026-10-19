# 03 — Screens, Field Lists, Form Copy and Layout Specification

## 1. Design principles
- Mobile first (320px up through desktop). Single clear primary action on each screen; clean white/neutral surfaces with restrained club branding; plenty of whitespace and readable font sizes.
- **Display information, not a system**: an organiser should understand Saturday's staffing without reading jargon. Use 'Can you help?', 'Invite to help', 'Expected by role', 'Confirmed', 'Not replied'.
- Progressive disclosure: only five basic event fields; contact details and role eligibility advanced when needed; no 20-field create wizard.
- Form controls with visible labels, error messages next to fields, keyboard navigation, proper contrast, accessible focus states, loading/empty/error states; touch targets at least 44px where practicable.
- Admin quick actions: Add event, Add person, Request availability, Assign venue cover, Review applications.
- Never show a green tick for 'expected by role' or mere 'yes available' as if physically present or assigned.
- Keep one owner of truth. An event may show shared coverage context, but the assignment is stored/edited once.

## 2. Navigation and page contracts

### `/home` — member dashboard
- Next event to respond to (if any): event title, date/time, venue and **Yes / No**. If Yes: Full event / Specific time window.
- My pending direct invitations: Accept / Decline.
- My confirmed commitments and upcoming club events. Link to current opportunities and club contact directory.
- No irrelevant charts, report tiles or full CRM widgets.

### `/calendar` — everyone logged in
- Default: scrollable agenda grouped by day; views/list filters for My events, Team, Venue, Type, Date; week grid if feasible and accessible.
- Event cards: time (kickoff labelled as kickoff if separate), title, venue/external location, event type, optional teams, volunteer action only if enabled; explicit info-only styling.
- Overlapping events coexist under their day. Site-wide venue cover appears once at top of venue/day group, not repeated as separate copied assignments.
- Empty state links to next future events. Freemens Way hidden from active venue filters by default but available as archived/inactive toggle for admin.

### `/calendar/[id]` — event detail
Header: event title, date, time, location, type and notes, plus status. For volunteer response-enabled event: immediate question `Can you help? [Yes] [No]`, then time choice if yes.
Below (visibility rules apply):
1. Event-specific **Confirmed to help** (real assignments).
2. **Venue-wide coverage** (e.g. Kelly — Café 09:00–13:00); coverage overlaps clearly marked partial/full, derived by query.
3. **Expected by role** (team manager/coach, neutral expected status, not guaranteed).
4. **Available to help** (Yes replies not yet assigned).
5. Admin-only **Awaiting response / No response / Declined**, with request target group and buttons.
Admins: minimal contextual actions Invite Person, Edit Event, Copy Event, Request Availability, Cancel Event. Avoid showing sections with zero records to members.

### `/people` — directory
- Search by person or club position/team; filters Team, Volunteer, Official, Position, Applicants (admin only), Invited/Not invited (admin only).
- Private staff contact fields visible only to authorised admin/coordinators; members see public/opted-in role contact info, not raw personal records.
- People cards: name, club roles, relevant team, optional approved public contact channel, interest tags; portal status and routine-request setting are admin-only.
- Person detail for admin: Contact | Teams | Club positions | Normal availability | Volunteering interests | Event history | Account/invite and request settings. Minimise panels initially.

### `/manage/people/new` — Add Person
Always visible: Name (required), optional Email, optional Telephone, involvement tags Volunteer/Manager/Official/Other.
Below: two **independent** controls: `Send portal invitation now` (default OFF, requires email) and `Include in suggested availability recipients` (default OFF). Display precise consequences.
Optional accordion: Teams and role, club positions, usual availability, interests, notes. `Save person` should never send an email unless invite action explicitly selected and reviewed.
For people created without account, show `Not invited` rather than `Inactive volunteer`. Provide later Invite and manual availability recording.

### `/manage/events/new` — Create Event
Visible fields: `Event name *` | `Date *` | `Start time *` | `Finish time` (optional if no end known, labelled `Unknown end`) | `Where? *` (Marke Wood or Outside/away location); if inactive Freemens Way, unavailable for ordinary new events.
A single switch: `Ask volunteers for availability?` default false or last sensible value (do not automatically email). Optional accordion: Team, type, kickoff, opponent, competition, event description, publication status, organiser and repeat/duplicate.
Create action creates event only. After save, next screen offers `Request availability`, `Invite person`, `Assign shared venue cover` as optional separate actions. Do not require staffing numbers, duty templates or vacant shift quantities.

### `/manage/venue-cover` — Assign shared volunteer
Day/time range | venue | person | responsibility (café/opening/closing/general etc.) | optional note | Invite or Record agreed offline. One assignment saved. Show overlapping club events as *derived preview*, not separate checkboxes, with a note that it will appear alongside these events during overlapping times.
Change/cancel from this one record. Event page coverage is not edited as separate assignment.

### `/manage` — admin home
- Header with date/week range and two main quick actions `+ Event` and `+ Person`.
- `Needs attention`: awaiting confirmation, new volunteer applicants, events with requested people not responded, role recruitment opportunities needing follow-up. Sort by immediacy, not opaque health score.
- `This week`: grouped upcoming fixtures and meetings across both venues/external locations, overlapping notes, shared venue cover under each venue/day group.
- `People who can help`: contextual link to availability, no huge reporting panel.

### `/manage/club-roles` — positions and succession
List columns/cards: Title, Current holders, Occupancy (Vacant/Filled/Shared), Recruiting (Not recruiting / Seeking replacement / Extra help), public? and applicant count. Occupancy and recruitment flags independent.
Position details: concise summary, responsibilities, time commitment, location/skills/training, current postholders with dates, `Seeking a replacement` checkbox, `Need additional help` checkbox, `Advertise public vacancy` checkbox, designated contact, `Interested applicants`, optional `Handover` status.
A public visitor sees only deliberately published role opportunity copy, not name/phone of private postholders.

### `/volunteer` — public recruitment landing
Headline 'Volunteer with Cinque Ports FC', club tagline 'One Club. One Community. Together.', short intro reassuring no football experience needed and one-off help welcome. Browse public vacancies/replacement/support roles. Primary CTA `Offer to volunteer`.

### `/volunteer/apply` — public 3-step form
Anonymous completion. Clear progression `1 About you`, `2 How you'd like to help`, `3 Your availability`. Save only on final submit by default (avoid half-filled personal data); enable Back retaining in-memory local form values. Show non-login confirmation page. No user account created.

## 3. Public questionnaire — exact V1 questions

### Step 1: About you
| Prompt | Field | Required |
|---|---|---|
| Full name | text max 120 | Yes |
| Email address | email validated | Either email OR mobile/phone |
| Telephone number | tel, UK/international normalized if possible | Either email OR mobile/phone |
| How would you prefer we contact you? | email / phone call / WhatsApp / no preference; only offer channel supplied | Yes |
| Are you already connected to the club? | player / parent-carer / supporter / former member / community member / other / not currently | Optional |
| How did you hear about volunteering? | friend/family / social media / club event / website / other | Optional |
| Are you 18 or over? | Yes / No; if No, show separate 'Contact the club with a parent/carer' pathway instead of collecting minor details in this V1 public form | Yes |

### Step 2: Interests & strengths
Question: **What would you enjoy helping with?** Multi-select categories:
- Matchdays: gate/admission, refreshments/café, pitch/equipment setup, event support
- Grounds/facilities: pitch marking, maintenance/DIY, opening/closing, cleaning
- Football: team management/coaching, youth activities (subject to external eligibility), veterans/ladies support
- Club administration: club/senior/youth secretary, finance/bookkeeping, welfare/safeguarding (subject to vetting), committee/governance
- Promotion and events: social media, website/digital, photography/video, fundraising/sponsorship, community events
- **I'm not sure — please help me find a role** (prominent)
Question: **Are you interested in any advertised roles?** Optional public role list, multiple selections.
Question: **What are your strengths?** Multi-select: organisation, communication, administration, finance, IT/spreadsheets, social media/creative, practical/DIY, groundskeeping, coaching/sport, people/community, event planning, fundraising/sales, other.
Question: **Any relevant skills, experience or interests?** Optional text max 1000; avoid soliciting protected/sensitive details.
Question: **Would you be happy learning a role or shadowing someone?** Yes / Maybe / No.

### Step 3: Time and commitment
Question: **Roughly how much time could you offer?** Less than 2 hours/month; 2–4 hours/month; 5–10 hours/month; 10+ hours/month; Varies/not sure.
Question: **What type of involvement suits you?** Regular; occasional when needed; one-off events/projects; unsure.
Question: **When are you generally available?** Simple day × daypart grid (Mon–Sun × Morning/Afternoon/Evening); choose any or choose Varies. This is *not* an event commitment.
Question: **Where would you prefer to help?** On-site; From home/remote; Either.
Question: **Anything else you'd like us to know?** Optional free text max 1000.
Required footer: visible link to current club privacy notice, acknowledgement of having read it, version stored on submission. Separate optional choice for receiving unrelated club newsletters/marketing (do not bundle with application follow-up).
Submit CTA: `Send my volunteering interest`.
Success text: `Thank you for offering to help. Your details have been received and someone from Cinque Ports FC will contact you if there is a suitable opportunity.` Do not promise a specific time frame.

## 4. Applicant review admin UI
`/manage/applications` list: New, In Review, Contacted, Trial/Shadowing, Accepted into Pool, Closed; search; sort oldest/newest; follow-up due; role interest chips. Alert on possible duplicate person record, show side-by-side before merge/link. Application detail shows all answers, preferences, interests, role suggestions with explanations, next contact and notes. Actions: Mark contacted, Follow up, Link existing person, Approve/create person, Match to position, Send explicit portal invitation (separate action), Close/delete per policy.

## 5. Suggested role-matching approach
Do NOT introduce an AI service or automatic rankings unless necessary. Build explainable optional suggestions:
- Direct applicant-selected position interest = strongest positive.
- Shared interests and applicant strengths match position desirable skills.
- Typical availability/commitment overlaps position needs.
- On-site/remote preference compatible.
- `Willing to shadow` helpful for seeking-replacement roles.
- Flag required safeguarding/FA process as human step, never auto-qualified.
Display human-readable reasons; no automated acceptance/rejection or opaque suitability score presented as certainty.

## 6. Interaction design and empty/error states
- Clear `No upcoming events` and `No new applications` rather than blank dashboards.
- For failed email: keep pending record, show `Invitation not sent — retry`, don't claim delivery.
- For no response yet: 'Awaiting response' if invited; 'Not asked' otherwise.
- For event with unknown duration: `Kick-off 10:30 — finish not recorded`, not '10:30–13:00' guessed.
- For a venue-level shift overlapping multiple events: one card with `Also supports 3 overlapping events` dynamically calculated.
- For someone assigned to two potentially incompatible venues at overlapping times: warning requires organiser to resolve or explicitly document deliberate exception; don't silently create impossible attendance.
- For application duplicate: show review flag; don't overwrite another person's contact data.
- For failed request: preserve form values and provide clear retry, never send duplicate email on retry.

## 7. Visual QA checklist
Mobile phone small screen; desktop wide screen; keyboard-only; high contrast; zoom 200%; readable tables on mobile as cards; datepicker UK format dd/mm/yyyy, times 24h; compact consistent badges: Available (blue/neutral), Expected (neutral), Pending (amber), Confirmed (green), Declined (neutral/red). Don't use only colour to convey meaning. Role recruitment badges distinct from occupancy. Prevent horizontal scrolling of primary event card UI.
