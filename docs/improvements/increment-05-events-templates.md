# Increment 5: event page layout, event creation and templates (brief §4–5, P1)

- **Branch:** `improve/events-templates` (from `main` at d27eead).
- **Data:** synthetic test data only. Nothing was run against the club database.

## What changed for organisers

### Event page (`/manage/events/:id`)

| Before | After |
| --- | --- |
| One long page: site cover, duties, then template adding, hand adding, time change, details and postpone/cancel forms | **Tabs: Duties · Details · Changes**. Each tab has its own address (`?tab=details`, `?tab=changes`). Old links and `#shift-…` duty links still land on Duties |
| Times in the header were "kick-off" text after the range | "Event 14:00–16:00 BST · Kick-off 14:00", plus a **Staffing** line: "2 of 7 places confirmed · 5 open" |
| Template and hand-added duty forms always open | Folded behind **Add duties** (open automatically when an event has no duties yet) |
| Re-applying a template could silently add a second duty of the same kind | A duty type the event already has is flagged: "⚠ this event already has a Pitch and equipment setup duty; ticking adds another". Nothing is deleted or blocked |
| Remove duty: a reason box and a confirm prompt | Also says first who it affects: "1 person is on this duty and will be taken off", and what happens to email |
| Change times: one confirm prompt | **Review step.** It shows Now vs New, every duty's current and new time **exactly as the database will save it**, who must reconfirm, the email status, and a note when template duties are re-timed. Nothing is saved until "Confirm new times". Then: "New times saved … N duty places need reconfirming" |
| Postpone / cancel | On the Changes tab, saying first: "This affects 1 person on 2 duties" and what happens to email |
| Editing details or a duty | Shows **"Unsaved changes"** until saved, and the browser warns before leaving the page with unsaved edits |

### New event

- **Clearer time labels:** **Event start**, **Event end** and **Kick-off (optional)**: "For information only. It doesn't move any duty times." Before, it said "Start (normally kick-off)", mixing the two up.
- **Real times next to each duty:** every template duty shows its actual clock time for the chosen date and time, next to its checkbox, as well as the rule.
- **No silent template removal:** switching to a venue a template doesn't belong to now explains why it no longer applies, instead of quietly clearing it.
- **A warning before losing work:** switching template after adjusting the duties or numbers asks first, and Cancel keeps your changes.
- **A prompt when there are no teams:** if no teams exist yet, the form says an administrator can add them in Setup → Settings. No teams are invented.

### Templates

- **Catalogue:** each card shows type, venue and default staffing. The full duty list is behind "Show the N duties", written as "From 45 min before the event starts until when the event starts".
- **Editor, one duty at a time:** each duty is a collapsed panel with a one-line summary.
- **Readable timing:** "**45 minutes | before | the event starts**" replaces signed numbers ("-45 min from event start"), with a **live example** for a 15:00–16:45 event. It saves the same stored rule, which unit tests check by round-tripping every offset, and refuses a duty that would end before it starts.
- **Clearer save scope:** "Save name and description" and "Save this duty" are separate, each says what it saves, and unsaved edits are flagged.
- **Separate guidance from instructions:** "Organiser guidance: when to switch this duty on (never shown to volunteers)" is kept apart from "Instructions for volunteers (copied into each new duty)".

## A finding that needs a decision

The template editor used to promise: "Existing events and their duties are **never** changed by editing a template." **That was not quite true.** When an existing event's date or times are changed, the database re-times each template duty from the template's **current** settings. It also overwrites any hand-adjusted time on such a duty.

The brief says not to change anchor rules without the club agreeing, so this increment does **not** change the behaviour. Instead:
- the editor now says exactly what happens;
- the new review step shows every duty's new time before anything is saved.

**Option to fix later, if the club wants it:** each template duty could keep a copy of the rule it was created with. Moving an event would then use that copy, and a hand-adjusted duty would simply move with the event. That is a small additive migration plus a one-off back-fill, so it is your call.

## Also fixed

The email wording helper from increment 2 said "an email to **they** will be queued" in pilot mode. That wording is live now in the postpone prompt. It now says "them", and a unit test covers it.

## Files

- `supabase/migrations/20261018000400_reschedule_preview.sql` (new) and `docs/sql/rollback-20261018000400.sql`.
- Event page `src/app/(manage)/manage/events/[id]/page.tsx` (tabs, review, impact). Event actions: reschedule now returns to a "saved" view.
- New event: `event-builder.tsx`.
- Templates: `templates/page.tsx`, `templates/[id]/page.tsx`, `templates/[id]/timing-fields.tsx` (new), `templates/actions.ts`.
- `src/lib/domain/template-timing.ts` (new).
- `src/components/action-form.tsx` (`trackChanges`).
- `src/components/manage-nav.tsx` (`SubTabs`).
- `src/lib/data/manage.ts` (`loadReschedulePreview`).
- `src/lib/email/state.ts` (pronoun fix).
- Tests:
  - `tests/unit/template-timing.test.ts` (new)
  - `tests/unit/messaging-state.test.ts`
  - `tests/db/assignments.db.test.ts` (preview = result)
  - `tests/db/privileges.db.test.ts` (+1 function)
  - `tests/e2e/improve-events-templates.mts` (new)
  - `tests/e2e/phase5-organiser.mts` (opens the Changes tab for postpone and cancel).

## Database change and rollback

One migration:
1. A new **internal** function `_rescheduled_shift_times()`. It can't be called directly, and is the single place new duty times are worked out.
2. `reschedule_event()` is replaced to use it. Its signature, permissions and behaviour are unchanged, and every existing reschedule DB test passes.
3. A new read-only `preview_reschedule()` for organisers who manage the event. It returns nothing to anyone else.

A DB test moves an event with both a template duty and a hand-made duty, and checks that the preview equals what is then saved and that the preview saved nothing.

- **Rollback:** `docs/sql/rollback-20261018000400.sql` restores the previous `reschedule_event()` and drops both new functions. It touches no data.
- **Order:** run the SQL **before** deploying. Without it the review step can't load.

## Test results (this branch, 18 Oct 2026)

| Suite | Result |
| --- | --- |
| typecheck, lint | clean |
| `vitest run` (unit + DB) | **26 files, 406 tests passed** (including the pronoun test) |
| e2e phase 3 / 4 / 5 / 6 / 7 | 25/25, 37/37, 47/47, 39/39, 19/19 |
| e2e increments 2, 3, 4 (regression) | 12/12, 19/19, 17/17 |
| e2e increment 5 (new) | **26/26** |

## Not verified

- **Unsaved-changes warning on in-app links.** It covers closing or reloading the tab. It does not intercept clicks on in-app links, because Next.js client navigation doesn't fire the browser's leave-page warning. The "Unsaved changes" label is still shown.
- **Accessible dialogs.** No dialogs or drawers were added: editing uses in-page panels, so there is no focus to restore.
- **Real devices and screen readers.** No pass on a real phone or with a screen reader.
