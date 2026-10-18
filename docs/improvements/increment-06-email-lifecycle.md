# Increment 6: safe email switch-on (brief §6, P0 rollout gate)

- **Branch:** `improve/email-lifecycle` (from `main` at 60cb1ff).
- **Data:** synthetic test data and a fake mail provider only. No real email was sent and nothing was run against the club database.

## The problem this fixes

Before this step, switching on `EMAIL_SENDING_ENABLED` in Vercel would make the next run send **every message still waiting in the queue**. That included messages that were no longer true. The "before" screenshot shows it: a volunteer signs up for two duties and withdraws from one while email is held. When sending starts, the old build sends **both** "you're confirmed" emails, including one for the duty they already withdrew from. Only reminders were re-checked before sending.

## What changed

### 1. A second switch: nothing is sent until an administrator starts email

Email now needs **both**:
1. the **hosting switch** (Vercel: `EMAIL_SENDING_ENABLED`, pilot or production mode), as before, and
2. **"Start email"** in Setup → Settings → Email (new, stored in the database).

Turning the hosting switch on **never** releases the queue by itself.

When starting, the administrator sees what is being held, by type: how many messages are still true, how many are out of date, and how many people they would reach. No addresses or content are shown. They then choose:
- **"Start: new emails only (recommended)"**: everything queued earlier is held back for good, and only messages from now on are sent.
- **"Start, and also send the N still-true held emails"**: out-of-date ones are dropped, and the ones that are still true are sent.

Both ask for confirmation, and both are recorded in the audit log (who and when).

- **Pause:** **"Pause all emails"** stops sending again at any time.
- **Starting is only possible once the hosting switch is on and set up**, so messages can't pile up and all go later.
- **A warning if the switches disagree:** if the hosting switch is later turned off while email is still started, Settings says so and suggests pausing first.

### 2. Every message is re-checked just before it is sent

Before, only reminders were re-checked. Now:

| Message | Sent only if… | Otherwise recorded as |
| --- | --- | --- |
| Any volunteer message about their duty (confirmed, invited, approved, withdrawn, cancelled, postponed, reconfirm…) | the duty is **still in the state the message describes**, and **no newer message** about the same duty is waiting | `status_changed`, `superseded`, `duty_gone` |
| Day-before reminder | duty still confirmed, active, published and in the future (unchanged) | `duty_no_longer_active` |
| Organiser alert: cancellation request | the request is **still waiting** for a decision | `request_resolved` |
| Organiser alert: site cover at risk | the event is still open and not over | `event_closed` |

These existing safeguards are unchanged and still apply:
- demo events never send;
- in pilot mode only allow-listed addresses receive mail;
- messages about a duty that has already started are dropped;
- suspended volunteers get nothing;
- each message has a duplicate-proof key, so a retry can't deliver twice;
- retries are bounded (2, 4, 8 and 16 minutes, then failed after 5 attempts);
- a failed email never undoes a sign-up or change.

Sign-in codes are separate (Supabase Auth) and are not affected by either switch.

### 3. Wording everywhere follows the real state

A new state, **"paused"** (hosting switch on, but email not started), is used across the app. While paused, organiser messages say "Email is paused, so the volunteer has not been emailed. Tell them yourself." They never say "on its way". If the release state can't be read, the app assumes paused rather than promise an email.

### 4. Settings → Email

- **Both switches** are shown in plain words, plus an overall status.
- **Held emails** are shown in a table by type: held, still true and people.
- **Start and pause** are separate buttons, and after either one a confirmation stays on the page.
- **Counts:** Queued, Sent, Failed and Not sent. "Not sent" covers held, out-of-date, demo and pilot-mode messages.
- **Retry:** "Retry failed emails" now explains its limits: up to 5 more attempts, each re-checked before sending.

## Files

- `supabase/migrations/20261018000500_email_release_gate.sql` (new) and `docs/sql/rollback-20261018000500.sql`.
- `src/lib/email/state.ts` (new "paused" state and wording) and `src/lib/email/state-server.ts` (new: combines the hosting switch with the release switch).
- Callers updated to the combined state: `events/actions.ts`, `events/[id]/page.tsx`, `shifts/[shiftId]/assign/page.tsx`.
- `settings/page.tsx` (Email card) and `settings/actions.ts` (`setEmailReleaseAction`).
- `src/lib/data/manage.ts`: `loadEmailBacklog` and `loadEmailRelease`.
- Tests:
  - `tests/db/outbox.db.test.ts` (+7: held, admin-only, new-only, include-current, pause, re-check, alert resolved)
  - `tests/db/privileges.db.test.ts` (+2 functions)
  - `tests/unit/messaging-state.test.ts` (paused wording)
  - `tests/e2e/improve-email-release.mts` (new)
  - `tests/e2e/phase6-email.mts` (starts email in Settings first; the crash check counts only its own email, because the same run may now also send the first reminder)
  - `tests/e2e/improve-truthful-states.mts` (starts email so it keeps testing pilot wording)

## Database change and rollback

- **The change:**
  - a new column `club_settings.email_released_from`; **NULL means held**, which is the state straight after deploying;
  - an internal `_outbox_obsolete_reason()`;
  - `outbox_claim()` and `outbox_enqueue_reminders()` replaced, with the same signatures and grants;
  - new admin-only `admin_email_backlog()` and `admin_set_email_release()`.
- **Data:** no message rows are deleted. Suppressed ones stay, with their reason.
- **Rollback:** `docs/sql/rollback-20261018000500.sql`. **Warning:** after rollback, the worker again sends every pending message as soon as the hosting switch is on.
- **Order:** run the SQL **before** deploying. Without it the Settings page can't load the new figures, and the app treats email as paused.

**Effect on the live club right now:** none visible. The hosting switch is off and email stays held. When the club is ready: switch on the hosting setting in Vercel, then open Settings → Email, review what is held and press Start.

## Test results (this branch, 18 Oct 2026)

| Suite | Result |
| --- | --- |
| typecheck, lint | clean |
| `vitest run` (unit + DB) | **26 files, 414 tests passed** |
| e2e phase 3 / 4 / 5 / 6 / 7 | 25/25, 37/37, 47/47, **41/41** (+2), 19/19 |
| e2e increments 2, 3, 4, 5 | 12/12, 19/19, 17/17, 26/26 |
| e2e increment 6 (new, fake mail provider) | **11/11** |

The new e2e checks, with the hosting switch on (staging mode and an allow-list):
- a fresh club database starts held;
- the scheduled job sends nothing while held, and messages wait rather than being lost;
- the invite page says "paused";
- Settings shows both switches and the held table, with no addresses;
- "start and include still-true" delivers the still-true confirmation and withdrawal emails but **never** the out-of-date "you're confirmed", with the reason recorded;
- after starting, Pause is offered with a "since" time;
- after pausing, new messages are held, not sent.

## Not covered (rest of brief §6, P1 extension)

- **Unanswered-invitation follow-ups:** none are sent. There is no automatic chasing yet, by design.
- **Mail-sink route for every test:** e2e uses the fake provider, and DB tests don't send.
- **The scheduler itself:** the scheduled job is still not set up on the live site, which is a choice for Carl (`deployment-checklist.md` §2.3). Confirmations go out straight after each change. Reminders and retries need the scheduled job.
