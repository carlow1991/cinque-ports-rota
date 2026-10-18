# Increment 7: shared venue cover (brief §7)

- **Branch:** `improve/shared-cover` (from `main` at 98c0f6d).
- **Data:** synthetic test data only. Nothing was run against the club database.

## Already in place (kept, and covered by tests)

- **Venue-cover links** are same-venue only, with no chains. Linking **never** counts as cover by itself.
- **Cover is worked out as a union** of confirmed, eligible site-lead time on the event and its linked cover event. Gaps are exact intervals, not half-hour buckets, so a one-minute gap is caught (new test).
- **Coverage is recalculated live:**
  - changing or cancelling the parent cover event recomputes every linked event;
  - a lapsed authorisation, a suspension, a lead who asks to cancel (increment 2) or a reset for reconfirmation removes that time from cover immediately;
  - an invitation or a lead awaiting approval never counts (new test for awaiting approval).
- **Clash checks** use each duty's own times, not kick-off, and the invite picker explains a clash before inviting.
- **Provider decisions** are admin-only, need a reason, and record who and when (a database constraint). Client-side toggles can't bypass them.
- **"Expected on site"** is labelled as expected headcount, not proof or a safety certificate.

## What changed

| Where | Before | After |
| --- | --- | --- |
| Event → Site cover | A plain list of same-venue cover events (±24 h) | Says **when this event needs a lead**: its own time **plus setup and clean-up duties**, e.g. "08:15–12:30". **Suggests** the best cover event ("planned for the whole time"), with the reminder that linking isn't cover by itself. Each option says how it fits, e.g. "misses 08:15–10:00", or "doesn't overlap"; best fits first |
| New event → venue cover choice | Title and time only | Same fit labels, worked out from the planned duties as you type |
| Site-lead duty | Splitting meant editing one duty's end time and adding another by hand, without carrying over opening and locking | **"Split into a handover (two site leads)"**: pick the handover time and see both parts live, e.g. "First lead 08:00–11:00 · open and unlock, facility checks" / "Second lead 11:00–14:00 · lock and secure, facility checks". The parts meet exactly, so there is no gap by design. Each part then needs only its own authorisations |
| A lead duty with someone already on it | n/a | Splitting is explained, not offered: "Split it before anyone is invited or signs up" |
| Provider / not-required decision | Badge and reason | Also "Recorded by an administrator on 18 Oct at 21:40" |

## Database change and rollback

There is one new function, `split_site_lead_shift(shift, handover)`. It runs in one transaction and checks:
- organiser access to the venue;
- the duty is a site lead, still open and not started;
- the handover is at least 15 minutes from either end;
- nobody is invited, awaiting approval or confirmed on it.

It shortens the original, adds the second part with the same headcount, settings and instructions, and moves opening to the first part and locking up to the second. Both parts become hand-made duties (the template link is cleared), so moving the event later moves them together rather than stretching the first back to the template's full window. Existing audit triggers record it.

- **Rollback:** `docs/sql/rollback-20261018000600.sql` drops the function. Duties already split stay as two duties.
- **Order:** either order is safe. Without the function, only the Split button fails, with a friendly error.

## Files

- `supabase/migrations/20261018000600_split_site_lead.sql` (new).
- `src/lib/domain/cover-fit.ts` (new): required window, fit and ranking, split preview.
- `src/app/(manage)/manage/events/[id]/split-form.tsx` (new).
- Event page: suggestions, fit labels, split, decision date.
- `events/actions.ts`: `splitSiteLeadAction`.
- `new/event-builder.tsx`: fit labels.
- `src/lib/data/manage.ts`: `external_cover_verified_at`.
- Tests:
  - `tests/unit/cover-fit.test.ts` (new)
  - `tests/db/coverage.db.test.ts` (+5: split happy path with the exact remaining gap, per-part authorisations, refusals, one-minute gap, awaiting-approval lead)
  - `tests/db/privileges.db.test.ts` (+1)
  - `tests/e2e/improve-shared-cover.mts` (new)
  - `tests/e2e/improve-organiser-overview.mts`: one check now waits for the back-navigation to finish. It failed once in eight runs because it read the page before it had re-rendered.

## Test results (this branch, 18 Oct 2026)

| Suite | Result |
| --- | --- |
| typecheck, lint | clean |
| `vitest run` (unit + DB) | **27 files, 425 tests passed** |
| e2e phase 3 / 4 / 5 / 6 / 7 | 25/25, 37/37, 47/47, 41/41, 19/19 |
| e2e increments 2–6 | 12/12, 19/19, 17/17, 26/26, 11/11 |
| e2e increment 7 (new) | **12/12** |

## Not done (left for the club to decide)

- **Travel time between venues:** there is no buffer for a volunteer moving between venues, as the brief says not to invent one. If the club wants a minimum gap between duties at different venues, it can be a Setting.
- **More than two parts:** the split makes two parts per action, but a part can be split again.
- **Who recorded a provider decision:** the database records the administrator's ID, but the page doesn't show their name. Coordinators may not see every administrator's details.
