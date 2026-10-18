# Improvement baseline (brief §0)

This document maps what already exists against the Implementation Brief, before any change. It was written on branch `improve/truthful-states`, from `main` at 33e273d (the live pilot build).

The rule taken from the brief: where a capability exists, make it visible or truthful. Do not build a second one.

## Routes (all present, all kept)

| Brief route | File | Notes |
| --- | --- | --- |
| /login | `src/app/(auth)/login/page.tsx` | Email code (OTP), `shouldCreateUser:false`: only invited people can sign in |
| /rota, /rota/:event | `src/app/(volunteer)/rota/…` | Open duties; signup through `self_signup` RPC |
| /my-duties | `src/app/(volunteer)/my-duties/page.tsx` | Tabs: upcoming, invited, past; ICS per duty at `my-duties/[id]/calendar` |
| /profile | `src/app/(volunteer)/profile/page.tsx` | |
| /manage | `src/app/(manage)/manage/page.tsx` | Fixed "Next 7 days" dashboard + counts |
| /manage/approvals | "Needs action" | Approvals, late cancellations, unanswered invites (`manage_action_queue`) |
| /manage/coverage (+ /print) | coverage page | Filters: date, span (day/7 days), venue, team, duty, include full |
| /manage/calendar | week view | |
| /manage/events/new, /manage/events/:id | event building | Draft-first; templates applied on the event page |
| /manage/shifts/:shift/assign | invite picker | `volunteer_picker` |
| /manage/volunteers | admin add/access; coordinators read only | |
| /manage/templates (+ /:id) | template catalogue + item editor | Future-events-only rule (D-3xx) |
| /manage/settings | venues, teams, duty types, club settings, Email card | |
| (extra) /api/cron/outbox | email worker | Bearer `CRON_SECRET` |

## Where the logic lives

- **Coverage: one authoritative calculation.** It is `public.event_site_coverage(event)` in the database:
  - the required window is the event plus all of its active duties;
  - covered time is the union of confirmed, eligible site-lead intervals, on this event or its linked venue-cover event;
  - gaps are the window minus that union (`tstzmultirange`), so a one-minute gap is caught regardless of the half-hour display.
  - `manage_events_overview` calls it for every event, and the dashboard, calendar, coverage list, print and event card all read `cover_state` from there. Exact gaps come from `loadCoverGaps` (same function). Nothing recomputes cover in React.
- **Staffing counts:** pure `src/lib/domain/staffing.ts`. Counts are per duty row; included responsibilities add no places. Invited is never counted; pending approval holds a place.
- **"Expected on site":** same file, counting unique confirmed people per half hour. It is labelled as an expectation, not proof.
- **Venue scoping:** RLS plus `can_manage_venue` / `can_manage_event` in every RPC. `coordinator_venues` limits coordinators. Volunteers never see other volunteers' contacts (`coordinator_can_see_volunteer`).
- **Mutations:** SECURITY DEFINER RPCs with `search_path=''`. Server actions in `src/app/(manage)/manage/*/actions.ts` and `src/app/(volunteer)/*/actions.ts` call them. The allow-list test is `tests/db/privileges.db.test.ts`.
- **Email:**
  - Messages are queued in `notification_outbox` in the same transaction as the change. Each has a dedupe key, so it is enqueued only once.
  - The worker (`src/lib/email/worker.ts`) runs from cron and after a change (`kickOutbox`).
  - The gates are `EMAIL_SENDING_ENABLED`, `APP_ENV` (only `production` sends to everyone) and `EMAIL_STAGING_ALLOWLIST`. Demo events and stale duties are suppressed.
  - Auth invitations are separate (`AUTH_INVITES_ENABLED`, `src/lib/supabase/admin.ts`).
- **Scheduler:** `/api/cron/outbox` (also queues day-before reminders). It is not scheduled yet on the live site: the options are in `deployment-checklist.md` §2.3, and confirmations go out straight after each change via `kickOutbox`.
- **Style:** Tailwind 4 tokens (`club`, `club-blue`, `ink-muted`, `line`, `danger`), with primitives in `src/components/ui.tsx` (Card, Badge, Notice, CoverBadge, LinkButton, Field…) and `ActionForm` (pending state, result message, confirm).

## Tests that exist

- Unit tests (`tests/unit`) cover staffing, London time/DST, templates, email rendering and worker gates, env rules and server enforcement.
- DB tests (`tests/db`, real Postgres) cover permissions, privileges allow-list, assignments (cutoff, late cancellation, capacity race), coverage (union, split handover, partial gap, lapsed authorisation, provider cover, cancel cascade), outbox, anonymise and demo seed refusal.
- Playwright phone-width journeys (`tests/e2e/phase3…7`) run against a fake Supabase and a fake mail sink. They can never reach real email.
- Synthetic matrix coverage: both venues, authorised and unauthorised people, a one-venue coordinator, an admin, draft, published, cancelled and postponed events, all assignment states, overlaps, shared cover with and without a gap, and DST (unit). Production is never seeded: the demo seed refuses to run if real events exist.

## Gaps against the brief, by increment

| # | Brief section | What is missing or misleading today | Planned |
| --- | --- | --- | --- |
| 2 | §1 Truthful state | Coverage says "Everything is filled" or "every event has a lead" when there are no events or no matches. A lead with a pending late cancellation still counts as cover. The picker says "Available" though only clashes are checked. Notices say "has been told" or "Invitation sent" while email is off. "Add and invite" appears while invites are off and points an organiser at a script. Settings doesn't warn about a queued backlog | **Done in increment 2** (see `docs/improvements/increment-02-truthful-states.md`) |
| 3 | §2 Overview | The home page is a fixed 7 days with no 28-day range, presets or bookmarkable range. There is no single attention list sorted by severity. Navigation is still 8 peers rather than Overview/Events/Volunteers/Setup | **Done in increment 3** (`docs/improvements/increment-03-organiser-overview.md`) |
| 4 | §3 Volunteer | No next-duty card on volunteer home. Button wording is not "Take this duty" / "Request this duty". There are no meeting-point or contact fields, so additive migrations are needed (with club-approved content only) | **Done in increment 4** (`docs/improvements/increment-04-volunteer-home.md`); meeting point and contact await a club decision |
| 5 | §4–5 Event & templates | The event page is one long page (stacked edit forms). Kick-off is not labelled separately from the operational start. There is no sample-time preview in the template editor | |
| 6 | §6 Notifications | **Rollout gate:** turning `EMAIL_SENDING_ENABLED` on today would send every still-pending queued message about a future duty. Only stale (already-started) duties are suppressed. This needs expiry, re-evaluation and a preview before the switch is used. A failed email is already separate from the assignment | Must be done before email is switched on |
| 7 | §7 Shared cover | The model is sound and tested. Gaps: no guided split-shift editor and no same-venue cover suggestion | |

The live database also has a migration-history misalignment. It is cosmetic, and `docs/sql/align-migration-history.sql` is ready for Carl to run.
