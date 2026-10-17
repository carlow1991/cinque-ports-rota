# Admin and organiser guide

How the club runs the rota day to day. Everything works on a phone.
**Administrators** see everything. **Coordinators** see and manage only their own venues. **Volunteers** see the rota and their own duties.

## The organiser menu
| Page | What it's for |
|---|---|
| **Dashboard** | The next 7 days: events, duties still needing people, site-lead warnings |
| **Needs action** | Late cancellation requests (most urgent first), approvals, unanswered invitations |
| **Coverage** | Missing or at-risk site leads with the exact uncovered times, duties needing people, and how many people are expected on site. Filter by venue, day/week, team and duty. **Print** gives one page per day |
| **Calendar** | Month view of everything at your venues |
| **New event** | Create a fixture, training session or club event, usually from a template |
| **Volunteers** | People, access, venues and club authorisations (admins); a read-only list for coordinators |
| **Templates** | The nine-duty templates T01–T09. Staffing numbers are **suggested defaults, not statutory or FA minimums** |
| **Settings** (admins) | Venues, teams, duty names, the withdrawal cut-off, reminders, and the Email card |

## Week-to-week routine
1. **Create events** (New event): pick the venue, type, team and times, then a template. The duties appear with suggested times and numbers; adjust them.
2. **Decide site cover** before publishing: the event's own site lead duty, a link to a venue-wide cover event (e.g. a Saturday's operations), external provider cover, or "not required" (admins only, with a note).
3. **Publish.** Volunteers can now see it and sign up. Drafts are invisible to volunteers.
4. **Fill gaps:** Coverage → *Find someone* → invite people. The picker shows who is available, who needs an authorisation, and who already has a duty at that time. An invitation doesn't hold a place until it's accepted.
5. **Check Needs action** a few times a week: approve or decline requests, and decide late cancellations. The volunteer **stays on the duty until you decide**, so cover isn't lost silently.
6. **Day before:** volunteers get a reminder at 18:00. Print the day rota from Coverage if useful (it has names and phone numbers, so keep it safe and bin it securely).
7. **On the day / after:** mark attendance on the event page, then **Mark event completed**.

## Changes and cancellations
- **Postpone** (with a reason): everyone is asked to reconfirm. Set the new date, publish again, and people accept again. Duties that need approval go back through approval.
- **Cancel** an event or a single duty (with a reason): everyone is told and their reminders are stopped.
- **Remove someone** from a duty: a reason is required, and they're told.
- **Losing a venue-wide site lead** automatically warns organisers of every linked event (Coverage shows "Site lead missing or at risk").

## People (administrators)
- **Add a volunteer:** Volunteers → Add, with name, email and role. They receive an invitation email. Re-adding the same email updates, never duplicates.
- **Coordinators:** give them their venues. They then see only those venues' events and people.
- **Club authorisations** (e.g. site lead): set with an expiry date. It's an eligibility flag only. **Never record DBS or safeguarding details in the rota.**
- **Suspend** someone who has left: they can't sign in and receive no emails. It's reversible. To erase their details permanently, see `privacy-and-access-review.md` §6.
- The app always keeps **at least one** administrator; keep **two**.

## Email (Settings → Email)
- Shows whether sending is on, and whether it's in **test/pilot mode** (only listed addresses receive email) or live.
- Counts for the last 30 days: waiting, sent, failed, and **not sent (by design)**, e.g. demo events, suspended people, duties that have already started.
- **Retry failed emails** re-queues failures from the last 7 days (e.g. after an outage).
- Each person only ever gets details of their **own** duty. There are no rosters or other people's contact details in emails.

## Volunteers' side (what to tell them)
- Sign in at `https://rota.<club-domain>` with your email; you'll get a short number code by email (no password).
- **Rota:** pick a venue, see open duties, tap **Sign up** (or **Request** if it needs approval).
- **My Duties:** your upcoming duties, invitations to accept, **Withdraw** (up to 24 hours before), or **Ask to cancel** inside 24 hours. Add any duty to your phone's calendar.
- **Profile:** your name, phone and preferred venue.

## When something looks wrong
| Symptom | Likely cause / fix |
|---|---|
| "No access" after signing in | Their email isn't in Volunteers, or they're suspended. Add or reactivate them |
| Someone can't sign up for a duty | The duty needs an authorisation they don't have, or it clashes with another duty, or it's full or started. The duty card says which, in words |
| Emails not arriving | Settings → Email: is sending on? Pilot mode limits who gets mail. Check "Failed" and the last error. Ask them to check spam |
| A site lead warning that seems wrong | Check the lead's authorisation hasn't expired, and that their duty spans from the earliest setup to the end of cleaning |
| The page shows "Something went wrong" | Tap **Try again**. If it repeats, send the reference code shown to the person who manages the hosting |
