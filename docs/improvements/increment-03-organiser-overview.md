# Increment 3: organiser overview and navigation (brief §2, P0/P1)

- **Branch:** `improve/organiser-overview` (from `main` at 5b19344).
- **Data:** synthetic test data only. Nothing was run against the club database.

## What changed for people using it

| Where | Before | After |
| --- | --- | --- |
| Home (`/manage`) | "Next 7 days": six count tiles, a late-cancellation banner, then events by day | **Overview** defaults to the **next 28 days**, with **Today / Next 7 days / Next 28 days** presets. Each is a plain link (`/manage?range=7`), so it can be bookmarked and back/forward works. The dates shown are spelled out |
| What needs doing | Spread across tiles, the banner and the Needs action page | One **Needs attention** list, most urgent first. Each row shows venue, event and date, duty and time, the reason, and one action |
| Attention order | n/a | 1. **Urgent**: late cancellations; missing site lead or open places within 72 hours. 2. Later site-lead gaps. 3. Open places. 4. Reconfirmations. 5. Approvals. 6. Unanswered invitations. 7. Unpublished drafts. Within each group, soonest first. The first 8 are shown, the rest behind "Show N more" |
| Actions | n/a | "Find someone" opens the existing invite page for that duty. "Review request" opens Requests at the right section. "Fix site cover" opens the event. For a linked event, "Open venue cover" opens the cover event |
| Empty range | "No events in the next 7 days." | "No events in this range", plus the **next scheduled event with its date and site-cover risk**. A range with events but nothing to do says exactly why it is clear |
| Requests outside the range | Not shown | "N more requests are for duties after this range. See all requests" |
| Reconfirmations | Looked like fresh invitations | Shown as **"needs to reconfirm after a change"**, with their own section on Requests |
| Navigation | Nine peer links: Dashboard, Needs action, Coverage, Calendar, New event, Volunteers, Templates, Settings, Volunteer view | **Overview · Events · Volunteers · Setup**, with the current page underlined. **+ New event** is a primary button (in the bar on wider screens; on Overview and the Events pages on phones) |
| Events | Separate pages | Calendar, Coverage and Requests ("Needs action" renamed) share a tab switch. **All old URLs unchanged** |
| Setup | Separate pages | Templates and Settings share a tab switch. Settings only appears for administrators |
| Mode switch | "Volunteer view" link in the organiser nav; the only way back was Profile → organiser button | A "Volunteer view" / "Organiser view" button in the header. The way back appears only for admins and coordinators. It is a link only: every `/manage` page still checks the role itself |

## Files

- `supabase/migrations/20261018000200_queue_reconfirmations.sql` (new) and `docs/sql/rollback-20261018000200.sql`.
- `src/lib/domain/attention.ts` (new): the pure attention builder, the ordering rules and the range presets.
- `src/components/manage-nav.tsx` (new): the nav, the Events and Setup tabs, and the phone New event button.
- `src/app/(manage)/manage/page.tsx` (rewritten as Overview), `layout.tsx` (new nav).
- `approvals/page.tsx`: renamed Requests, adds a reconfirmations section and anchors.
- `calendar`, `coverage`, `templates`, `settings` pages: tabs only.
- `src/app/(volunteer)/layout.tsx` and `src/components/app-header.tsx`: the mode switch.
- `src/lib/data/manage.ts`: the queue kind type.
- Tests:
  - `tests/unit/attention.test.ts` (new)
  - `tests/db/organiser.db.test.ts` (reconfirmation)
  - `tests/e2e/improve-organiser-overview.mts` (new)
  - three existing e2e scripts updated for the renamed headings ("Next 7 days" → "Overview", "Needs action" → "Requests"). Their checks are otherwise unchanged.

## Reused, not duplicated

- **Data:**
  - The Overview reads exactly what the coverage page reads: `loadCoverageWindow` (one overview call and one roster call for the whole range) plus `loadActionQueue`.
  - Cover state comes from the database's single `event_site_coverage` calculation.
  - Exact gap times are fetched only for events the database has already flagged (`loadCoverGaps`). This is one extra call per flagged event, because there is no bulk gap function. It is usually zero to a few calls.
- **Actions:** every action goes to an existing page and form. No new mutations.
- **Coordinator scope:** unchanged. The overview, roster and queue functions all filter by `can_manage_venue`.

## Database change and rollback

`manage_action_queue` gets `CREATE OR REPLACE` with the same signature and return type, so the existing grant is kept. An invitation is reported as `reconfirmation` when that assignment's most recent status change, in the existing `audit_log`, came from confirmed or awaiting approval. That is what postponement and time changes do. Nothing is stored.

**Rollback:** run `docs/sql/rollback-20261018000200.sql`.

**Order:** either order is safe. Without the migration, the new pages simply show no reconfirmations, which is today's behaviour.

## Test results (this branch, 18 Oct 2026)

| Suite | Result |
| --- | --- |
| typecheck, lint | clean |
| `vitest run` (unit + DB) | **24 files, 392 tests passed** |
| e2e phase 3 / 4 / 5 / 6 / 7 | 25/25, 37/37, 47/47, 39/39, 19/19 |
| e2e increment 2 (regression) | 12/12 |
| e2e increment 3 (new) | **19/19** |

The new e2e checks, at 375px:
- the 28-day default finds an uncovered event 13 days out, with "No confirmed site lead · 11:30–17:00";
- a late cancellation is first and marked Urgent;
- a reconfirmation is shown as a reconfirmation;
- "Review request" lands on the right section;
- Next 7 days drops the 13-day event and counts later requests;
- back returns to the bookmarked range;
- the nav groups, old `/manage/coverage` URL, Events and Setup tabs and mode switch all work;
- a Freemens Way coordinator sees no Marke Wood items and no Settings tab;
- volunteers get no organiser switch;
- there is no horizontal scroll.

## Not verified

- **Empty-range Overview in a browser.** The test database always has events in every preset range. The empty and next-event logic is the same as the tested coverage page.
- **Real phone and screen reader.** There has been no pass with a real phone or a screen reader. The tabs and nav use `aria-current`, labelled `nav` landmarks and 44px targets.
- **Long lists.** With the club's real data the attention list could be long. It is capped at 8 visible rows plus "Show N more".

## Left for later (brief §2)

- A "Today" view that includes events already finished earlier today. Today is the whole UK day, as on the coverage page.
- A bulk gap function, if the number of flagged events ever makes the page slow. No performance claims are made.
