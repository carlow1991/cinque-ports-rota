# Increment 4: volunteer home and clarity (brief §3, P0/P1)

- **Branch:** `improve/volunteer-home` (from `main` at 0a3b5a9).
- **Data:** synthetic test data only. Nothing was run against the club database.

## What changed for volunteers

| Where | Before | After |
| --- | --- | --- |
| Home (`/rota`, plain address) | A list of events with "N places you can take" | **Your next duty** first: date, **Arrive HH:MM · Finish HH:MM (length)**, duty, event, venue and address, status (Confirmed / You've asked to cancel), postponed warning, add to calendar. Then **Waiting for you** (invitations to answer, approvals pending). Then **Duties you can take**: up to 6, next 8 weeks. Then the full **All events** list, unchanged, with its filters |
| No commitments | Straight into the event list | "You're not down for any duties yet. Here are some you can take. Even an hour makes a difference." (or, if nothing is open to them, says so and points to all events) |
| Opportunity cards | Per event: "4 places you can take" | Per duty: task, day, time, length, event, venue, places left, "Needs approval" where it applies. Opens the event page scrolled to that duty |
| Restricted duties (e.g. site lead) | Mixed into the counts by event | Not offered on the home page. Still visible, with the 🔒 reason, on the event page and in All events |
| Event page | "14:00–16:00 GMT · kick-off 14:00"; each duty showed a bare time range | "**Event** 14:00–16:00 GMT · **Kick-off** 14:00". Each duty says **Arrive / Finish (length)**, plus a note that each duty has its own times. Lengths are real lengths across the clock change |
| Sign-up button | "Sign up" / "Request this duty" | **"Take this duty"** / **"Request this duty"**. A screen reader hears the duty, day and time, e.g. "Take this duty: Pitch and equipment setup, Wednesday 21 October 2026, 13:00 to 14:00". It is still disabled while saving, success is shown only after the database confirms, and the confirmed state persists on reload |
| Signed-out deep link | Sign in → always the home page | Sign in → **back to the page they asked for** (e.g. the duty's event). Unsafe or external addresses are ignored, and a volunteer is never sent into the organiser area |

**Checked and unchanged:** volunteer pages show no organiser set-up guidance. Duty-type descriptions such as "split off if…" and template "when to enable" notes are never sent to volunteer pages. The e2e test checks for this.

## Not done, needs a club decision

The brief asks for a meeting point and "who to contact" on each duty. Neither exists as a field today. The brief says not to invent key-safe codes, safety instructions or contacts, and not to expose organisers' phone numbers. So this increment shows only what already exists: venue address, event information, duty instructions and included responsibilities.

To add them I need the club to choose:
1. **A shared club contact** for volunteers (e.g. a rota mobile or email) shown on duty pages, or none.
2. **A meeting point per venue** (e.g. "Clubhouse front door, Marke Wood"), if wanted.

Both would be small additive fields, set in Settings, and shown only to signed-in volunteers.

## Files

- `supabase/migrations/20261018000300_volunteer_opportunities.sql` (new, read-only function) and `docs/sql/rollback-20261018000300.sql`.
- `src/lib/domain/duty-time.ts` (new): duration and next confirmed duty.
- `src/lib/data/volunteer.ts`: `loadOpportunities`.
- `src/app/(volunteer)/rota/page.tsx`: home sections.
- `src/app/(volunteer)/rota/[eventId]/page.tsx`: labels, anchors, button wording.
- `src/components/action-form.tsx`: an optional fuller accessible name for the submit button.
- `src/lib/auth/paths.ts`: `returnPathAfterLogin`, which reuses the existing `safeNextPath`.
- `src/lib/supabase/proxy.ts`: remembers the page asked for.
- Login `actions.ts`, `schema.ts` and `login-form.tsx`: carry it through both sign-in steps.
- Tests:
  - `tests/unit/duty-time.test.ts` (new, including the 25 Oct clock change)
  - `tests/unit/access.test.ts` (return path)
  - `tests/db/volunteer-views.db.test.ts` (opportunities: rules, agreement with the rota count, privacy)
  - `tests/db/privileges.db.test.ts` (allow-list +1)
  - `tests/e2e/improve-volunteer-home.mts` (new)
  - the button name and an ambiguous link selector updated in the phase 4 and 6 e2e scripts.

## Reused, not duplicated

- **Opportunity rules:** the new function copies `volunteer_rota`'s "eligible open places" rules exactly, and a DB test checks that the two agree.
- **Sign-up:** sign-up still goes through the existing `self_signup` RPC. Capacity, authorisation, clashes and duplicates are still enforced atomically in the database.
- **Home data:** "Your next duty" and "Waiting for you" use the existing `my_duties` and the My Duties grouping.

## Database change and rollback

- **The change:** one new read-only function, `volunteer_opportunities(from, to, limit)`. It is granted to signed-in users only, as the privileges test requires, returns nothing for suspended or signed-out callers, and contains no names or contact details.
- **Rollback:** `docs/sql/rollback-20261018000300.sql` drops it.
- **Order matters:** run the SQL before deploying. Without it, the new home page fails to load its "duties you can take" list.

## Test results (this branch, 18 Oct 2026)

| Suite | Result |
| --- | --- |
| typecheck, lint | clean |
| `vitest run` (unit + DB) | **25 files, 400 tests passed** |
| e2e phase 3 / 4 / 5 / 6 / 7 | 25/25, 37/37, 47/47, 39/39, 19/19 |
| e2e increments 2 and 3 (regression) | 12/12, 19/19 |
| e2e increment 4 (new) | **17/17** |

New e2e checks, at 375px:
- the next duty is shown first, with arrive/finish and status;
- invitations are listed as waiting;
- a brand-new volunteer gets the constructive message and duty cards;
- site lead is not offered;
- a card opens the event at the duty;
- the event window and duty times are labelled;
- the button has its full accessible name;
- **a double tap creates exactly one sign-up**, and it stays Confirmed after reload;
- the home page then shows it as the next duty;
- a signed-out deep link returns to the event after sign-in, while `//evil.example` and `/manage` are refused for a volunteer;
- no organiser guidance appears on volunteer pages;
- there is no horizontal scroll.

## Not verified

- **Last-place race in a browser.** It is covered by the existing DB concurrency test, not repeated here.
- **The emailed sign-in link.** It still goes to the home page; only the code flow returns to the page asked for. Adding the address to the emailed link would need the Supabase redirect allow-list changed.
- **Real devices and screen readers.** No pass on a real phone or with a screen reader.
