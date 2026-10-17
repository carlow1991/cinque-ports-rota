# Privacy and access review guide

For the club's administrators. This is not legal advice. The club, as data controller, should check it against its own data-protection policy (`club-decisions.md` B1).

## 1. What the rota holds
| Data | Why | Who can see it in the app |
|---|---|---|
| Name | So organisers and team-mates know who is on a duty | The person; organisers at their venues; **names only** to volunteers on the **same** published event |
| Email | Sign-in and the person's own duty emails | The person; administrators. **Never** organisers' lists, rosters, the printed rota, or any email to someone else |
| Phone (optional) | So the organiser can reach someone on the day | The person; organisers for people on duties at their venues; the printed day rota |
| Role, venue access, active/suspended | Access control | Administrators (coordinators see their own) |
| Club duty authorisations (flag + expiry date) | Some duties need club approval (e.g. site lead) | The person; administrators. **No DBS or safeguarding details, ever** |
| Duties, attendance, cancellation requests and reasons | Running the rota | The person; organisers at that venue |
| Audit history | Who changed what, for disputes and mistakes | Administrators. Email, phone and sign-in IDs are removed automatically |
| Email queue | Delivering the person's own messages | Nobody in the app. Administrators see counts only |

Not collected: date of birth, address, DBS/safeguarding information, payment details, children's details. The app is **not** a safeguarding record.

## 2. Where it is stored and who processes it
- **Supabase** (database and sign-in), project region **London (eu-west-2)**.
- **Vercel** (runs the website). No rota data is stored there; it passes through.
- **Resend** (sends the emails). It receives each recipient's address and their own duty details.
- The club should list these three in its privacy notice and keep their data-processing terms on file (`club-decisions.md` B1).

## 3. Volunteer privacy notice (suggested text for the club to approve)
> Cinque Ports FC uses an online rota to organise volunteers at Marke Wood and Freemens Way. It stores your name, email address, optional phone number, the duties you sign up for and whether you attended. Organisers at the venues where you volunteer can see your name and phone number. Volunteers on the same event can see your name only. We use your email to let you sign in and to send you messages about your own duties. We don't share your details with anyone else. The rota is hosted by Supabase, Vercel and Resend on the club's behalf. You can see and update your details on the **Profile** page. To have your details removed, contact <club contact>.

## 4. Quarterly access review (about 15 minutes, by an administrator)
Put it in the calendar for the first week of each quarter. Record the date and outcome in the committee minutes.
1. **Administrators:** Volunteers (filter *Active*): look down the access column for *Administrator*. There should be **at least two** and no more than needed. Remove admin from anyone who has stepped back.
2. **Coordinators:** check each coordinator's venues still match their role.
3. **Leavers:** suspend anyone who has left the club or not volunteered for 12 months (suspending is reversible and immediately blocks sign-in and emails).
4. **Authorisations:** Volunteers → each person's *Club authorisations*. Remove or let expire any club authorisation that's no longer right. Set an expiry date on new ones.
5. **Platform accounts:** in Supabase, Vercel, Resend and the club DNS, check who has access. Remove anyone who no longer needs it. Two-factor authentication on for everyone.
6. **Keys:** if anyone with access to a key has left, rotate it (`deployment-checklist.md`, "If something goes wrong").
7. **Retention:** run `docs/sql/retention-cleanup.sql` (§5).

## 5. How long data is kept (suggested; club decision B4)
| Data | Suggested period | How |
|---|---|---|
| Active volunteers | While they volunteer | — |
| Leavers | Suspend at once; anonymise on request, or after 2 years of no activity | `docs/sql/anonymise-volunteer.sql` |
| Duty and attendance records | Kept (as "Former volunteer" once anonymised) | — |
| Email queue entries | 90 days after finishing | `docs/sql/retention-cleanup.sql` (quarterly) |
| Audit history | 24 months | same script |
| Monthly exports | 12 months | delete older folders |

## 6. Requests from volunteers
- **"What do you hold about me?"** (subject access): an administrator exports their row and duties from the Supabase Table editor (filter by their email) and sends it to them securely within one month.
- **"Correct my details":** they can change their name and phone on **Profile**. An administrator can change anything else.
- **"Delete my details":** take them off upcoming duties in the app, suspend them, then run `docs/sql/anonymise-volunteer.sql` (change the one email line). It removes their name, email, phone and any reasons written about them everywhere in the database, keeps the duty history as "Former volunteer", and refuses to run if they still have upcoming duties or are the last admin. Then delete their user under Authentication → Users. Tested in `tests/db/anonymise.db.test.ts`.
- **Monthly exports** made before the request still contain their data until they age out (12 months). Mention this in the reply.

## 7. If something goes wrong (data breach)
1. Contain it: suspend accounts, rotate keys, or set `EMAIL_SENDING_ENABLED=false`, as fits.
2. Tell the club's data-protection lead the same day. Write down what happened, when, what data, and how many people.
3. The club decides within 72 hours whether it must be reported to the ICO and whether volunteers must be told. (A wrongly sent rota email usually isn't reportable, but record it.)
4. Fix the cause before switching anything back on.
