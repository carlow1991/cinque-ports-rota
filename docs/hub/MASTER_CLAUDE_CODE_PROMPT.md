# MASTER CLAUDE CODE PROMPT — Cinque Ports FC Volunteer Hub

You are my lead full-stack engineer, systems architect and senior UI/UX product designer. **Implement** the Cinque Ports FC Volunteer Hub in my **existing rota repository**. You are not simply producing mockups. Write production-quality source code, safe migrations, working accessible screens, protected server actions/routes, tests, and deployment documentation.

**This redesign supersedes all previous complex shift rota requirements.** The application must be a clean, easy-to-use volunteer/community hub, not a workforce-management system.

## Required specification
Read all files in this pack before changing code:
- `CLAUDE.md`
- `docs/hub/01_PRODUCT_AND_WORKFLOWS.md`
- `docs/hub/02_DATA_MODEL_AND_SECURITY.md`
- `docs/hub/03_UX_SCREENS_AND_QUESTIONNAIRE.md`
- `docs/hub/04_DELIVERY_STAGES.md`
- `docs/hub/05_ACCEPTANCE_TESTS.md`
- `docs/hub/06_INITIAL_SETUP_AND_DECISIONS.md`

## What we are building
**Foundation 1 — People Directory:** Store anybody connected with Cinque Ports FC (volunteers, managers, officials and contacts) **without forcing a login or invitation**. Add Person requires just a name; email/phone optional. Portal invitation and routine availability requests are independent settings, both off by default. Multiple team associations and multiple official roles per person. Manage contact visibility carefully.

**Foundation 2 — Unified Club Calendar:** Include every event: home/away matches, Mini Kickers, youth football, Ladies, Veterans, training, meetings, working parties, social events. Overlapping events must appear separately in an uncluttered date-grouped agenda. Event creation is minimal: title, date, time, venue/external location. Volunteers requested? toggle. No mandatory staffing templates or duty assignments. Marke Wood active, Freemens Way stored inactive.

**Foundation 3 — Availability and Commitments:** Members can answer Yes/No and, if Yes, select full event or a partial time window. These responses are **not assignments**. Organisers can manually invite people such as Bob or Steve to a Ladies fixture for a named responsibility; they accept/decline. Organisers can record agreement given offline for people without logins, clearly attributed to an admin. Managers Scott, Danny and Matty can be associated with their teams and appear as `Expected by role` without routine availability requests; expected does not equal confirmed.

**Shared Venue Cover:** One café assignment for Kelly covering Marke Wood 09:00–13:00 can provide context for Mini Kickers 09:00–11:00, youth fixtures and Veterans 10:30 kickoff. The café assignment is saved **once**, not duplicated for each event. Separate event-specific assignments are optional. Time-overlap calculations must be correct; do not invent a fixture finish when unknown. Surface incompatible cross-venue overlaps without blocking compatible shared same-venue activity.

**Club Roles and Recruitment:** Directory holds formal/informal roles with many-to-many postholders. Role occupancy (filled/shared/vacant) independent of recruiting flags (seeking replacement, seeking extra help, advertise vacancy). A person can remain holder of Club Secretary, Senior Secretary, Youth Secretary, Groundsman, Socials, Finance, Vice-Chairman and Welfare Officer while the club advertises selected posts for succession. Provide short public opportunities and interest forms; lightweight shadowing/handover progress. Actual formal appointments and safeguarding eligibility remain outside the app.

**Public no-login Volunteer Application:** Three short steps: personal/contact information; preferred club activities/roles/strengths/experience/willingness to learn; usual day/time slots, monthly commitment, one-off/regular preference, on-site/remote preference, optional notes and privacy notice acknowledgement. Crucial `Not sure — help me find a role` option. Public form creates private pending application in same database/review area, **not a portal account**. Admin reviews, checks possible duplicates, matches suggested roles with explainable rules, records contact and explicitly chooses whether to invite to the Hub. No automated appointment, sensitive-info collection or safeguarding clearance.

**Dashboards:** Simple volunteer Home and minimal admin Manage. Show this weekend's events, shared site cover, people expected vs available vs confirmed vs pending, applications requiring review, roles seeking support. Keep the main nav Home, Calendar, People, Opportunities, My Profile plus Manage for authorised organisers only.

## Technical boundaries and workflow
- First inspect current repository, actual database and auth. Reuse what works; preserve historical rota data, IDs and auth links. Don't guess existing migrations.
- Use existing compatible framework; recommended if present: Next.js/TypeScript, Supabase/Postgres/RLS, Tailwind CSS, Vercel and transactional email. No direct dependency on Carl OS.
- Work on a new branch and staging project. Production is read-only until I approve release. Do not send real invitations, delete legacy tables or deploy without explicit approval.
- All private data access requires server-side checks **and** Supabase RLS. Anonymous applicant endpoint uses server-only credentials, validation, anti-spam and rate limiting; never allow anonymous reads.
- Use `Europe/London` for display, with timezone-safe stored instants and DST tests.
- Request/sending actions are deliberate and audited. Do not auto-send messages on Create Person, Create Event or Submit Application.
- The previous nine duty types remain optional interests/labels only. Remove compulsory template/capacity/approval complexity from normal UX.
- Design readable mobile first pages with clean typography, limited badges, no labyrinth of tabs and only necessary inputs.

## Implement in stages, not a giant unreviewed migration
0. Audit repository/screens/schema/permissions; report migration and implementation plan; **no writes**.
1. People directory, access/invitation separation, teams and expected officials.
2. Calendar, minimal Create Event, inactive venue handling.
3. Event availability, targeted requests, direct assignment confirmation.
4. Venue-wide cover and overlapping-weekend dashboard.
5. Club position holders, recruitment flags, public opportunities and succession.
6. Public volunteer questionnaire, secure application inbox, dedupe and rule-based role suggestions.
7. Notifications, UX/accessibility polish, hardening, staged migration rehearsal and deployment runbook.

At each stage, actually write the code, run lint/typecheck/tests/build, supply changed file list and a brief demo. Test every C-numbered scenario in `docs/hub/05_ACCEPTANCE_TESTS.md` before production. Move to the next logical stage after a successful test except for irreversible, live-email or production-affecting decisions requiring my explicit approval.

## Start now
**Begin with Stage 0.** Show me what you found, what you will preserve, the migration approach, and the first stage's specific files. Then proceed with Stage 1 on a feature branch using development/staging data. Avoid unnecessary questions where the existing code or this spec already supplies the answer.
