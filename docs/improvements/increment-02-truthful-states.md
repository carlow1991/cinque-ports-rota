# Increment 2: truthful states and messaging (brief §1, P0)

- **Branch:** `improve/truthful-states`. Not merged and not deployed.
- **Data:** synthetic test data only. Nothing was run against the club database.

## What changed for people using it

| Where | Before | After |
| --- | --- | --- |
| Coverage, empty day | "Every event that needs a site lead has one confirmed…" and "No open places. Everything is filled." | "No events in this period." plus **Next scheduled: <event>, <date>** with a link to that day (or "Nothing else is scheduled") |
| Coverage, filters match nothing | "Everything is filled." | "No duties match these filters." |
| Coverage, events but no duties | "Everything is filled." | "No duties have been added to the events in this period." |
| Coverage, all filled | "Everything is filled." | "No open places: all N duties are fully confirmed." |
| Coverage, no event needs a lead | "Every event … has one confirmed" | "None of the events in this period need a volunteer site lead." |
| Gap wording | "No confirmed site lead: 10:00–12:00, …" | One line per gap: "No confirmed site lead · 10:00–12:00" |
| Site lead has asked to cancel late | Counted as cover, so the event showed green | **At risk.** The exact gap is listed, the duty row says "1 asked to cancel", and the event page badge says "Asked to cancel, not counted as cover". The assignment stays confirmed until an organiser decides (existing rule, kept); declining restores cover |
| Invite picker | "Available" | "No rota clash", plus a line saying what really happens to the invitation email (off / pilot-limited / on) |
| Organiser result messages (invite, approve, decline, remove, resolve cancellation, remove duty, postpone, cancel) | "…and have been told", "Invitation sent", "volunteers told" | Depends on the live email state: off says "has not been emailed. Tell them yourself."; pilot says "queued … only approved addresses receive email"; on says "on its way". Queued is never described as delivered |
| Event page cancelled/postponed banners, confirm prompts | "Everyone … has been told" | States what is known and asks the organiser to check people know when email is off or limited |
| Volunteers → Add (invites off) | Button "Add and invite"; message pointed at `scripts/invite-volunteer.mts` | Button "Add volunteer". Message: "Invitation not sent — email disabled. They can't sign in until they get one…" |
| My Duties late-cancel note | "An organiser will be told straight away" | "Your request goes straight to the organisers' list of things to deal with…" (true whether or not email is on) |
| Settings → Email | No mention of the queued backlog | When sending is off and messages are waiting, a warning that switching on would send queued messages about future duties, some possibly out of date |
| Dashboard, no events in 7 days | "No events in the next 7 days." | The same, plus the next scheduled event (with "draft" flagged) or a prompt to use New event |

## Files

- `supabase/migrations/20261018000100_late_cancellation_at_risk.sql` (new). See the database section below.
- `docs/sql/rollback-20261018000100.sql` (new): the exact previous definitions.
- `src/lib/email/state.ts` (new): `messagingState()` is one source for off / misconfigured / limited / on, built on the existing `emailConfig()`. It provides `notifyOutcome`, `notifyFuture` and `capitalise`.
- `src/lib/domain/staffing.ts`: adds an `at_risk` count (confirmed with a pending cancellation request). `open` is unchanged.
- `src/lib/data/manage.ts`: adds `loadNextEvent()` (one indexed query, limited to the viewer's venues, RLS still applies), and `CoverLead.cancellation_requested`.
- Coverage page, dashboard, event page, picker, volunteers page and action, event actions, settings page, my-duties page: wording only, plus the empty-state logic described above.
- Tests:
  - `tests/unit/staffing.test.ts`, `tests/unit/messaging-state.test.ts` (new)
  - `tests/db/coverage.db.test.ts`, `tests/db/organiser.db.test.ts`
  - `tests/e2e/improve-truthful-states.mts` (new; also has `MODE=before` for screenshots)
- Docs: `docs/improvement-baseline.md`, this report, `docs/screenshots/increment-02/{before,after}/`.

## Reused, not duplicated

- **Coverage:** still the single database function `event_site_coverage`. The dashboard, calendar, coverage list, print and event card get the new at-risk state automatically through `manage_events_overview`.
- **Late cancellation:** uses the existing `cancellation_requests` table and `resolve_cancellation_request` flow. `manage_roster` already returned `cancellation_request_id`.
- **Email state:** derived from the existing `emailConfig()` gates. No new mail code, and the worker is unchanged.

## Database change and rollback

There is one migration, and it changes no data.

1. **`event_site_coverage`** gets `CREATE OR REPLACE`. Its signature, return shape, security definer and grants are unchanged. One extra condition means a confirmed lead whose assignment has a **pending** cancellation request is not counted as covered time.
2. **`event_cover_leads`** gains one column, `cancellation_requested`. Because its return type changes, the function is dropped and recreated in the same transaction. It is then re-granted to `authenticated` only and revoked from public, anon and service_role, matching the allow-list test.

**Rollback:** run `docs/sql/rollback-20261018000100.sql` in the SQL Editor. It restores both previous definitions exactly. The app code on `main` reads neither the new column nor `at_risk`, so rolling back code and database in either order is safe.

**Production:** not applied. When Carl approves, the migration file is pasted into the Supabase SQL Editor (the connector cannot write) **before** this branch is merged. The new event page reads `cancellation_requested`, and would show it as missing until the migration is applied, falling back to the "Site lead confirmed" wording.

## Test results (run on this branch, 18 Oct 2026)

| Suite | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `vitest run` (unit + DB on PG16) | **23 files, 385 tests passed** |
| e2e phase 3 / 4 / 5 / 6 / 7 (regression, fresh build) | 25/25, 37/37, 47/47, 39/39, 19/19 passed |
| e2e `improve-truthful-states` (new) | **12/12 passed** |

New assertions include:
- a lead's late cancellation request makes the event at risk with a gap equal to the whole required window;
- declining the request restores cover, while approving it leaves the event at risk;
- `event_cover_leads` flags the request;
- `staffingByShift` counts `at_risk` without changing `open`;
- the email-state wording never claims delivery when sending is off, misconfigured or limited;
- the empty day, the filter with no matches, the gap line, the badge, the picker label and the pilot-mode invite note all render at 375px with no horizontal scroll.

## Not verified

- **Dashboard empty state in a browser.** The e2e database always has events in the next 7 days. The logic is shared with the coverage page, which is tested. A screenshot of the dashboard's new empty state was not taken.
- **Settings backlog warning in a browser.** The e2e server runs with email on (staging plus a fake mail sink). The condition is covered by the unit-tested `messagingState`, but the rendered warning was not exercised.
- **Off-state wording end to end.** As above, the e2e runs in "limited" mode, so off-state wording is unit-tested only.
- **Accessibility.** No screen-reader or real-mobile-browser pass for this increment. The changes are text within existing accessible primitives.
- **"Expected on site" headcount.** It still counts a lead who has asked to cancel, because they remain confirmed. This is shown on the coverage page alongside the at-risk notice. Whether to grey them out is a choice for the club.

## Known risk carried forward (rollout gate, brief §6)

Turning `EMAIL_SENDING_ENABLED` on today would send every still-pending queued message about a future duty. This increment only **warns** about it in Settings. Expiring or re-evaluating the queue before the switch is turned on is increment 6, and it must be done before email goes live.
