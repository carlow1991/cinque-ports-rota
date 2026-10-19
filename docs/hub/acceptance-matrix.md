# Volunteer Hub — acceptance test matrix

All tests run against throwaway local databases and the fake-Supabase harness (no real project, no real email).
`db/` = `tests/db/*.db.test.ts` (Postgres, real RLS and functions) · `unit/` = `tests/unit` · `e2e/` = `tests/e2e/*.mts` (production build in a browser).

| ID | What | Evidence | Result |
|---|---|---|---|
| C01 | Scott, name only, no login/email | db/hub-people · e2e/hub-stage1 | ✅ |
| C02 | Kelly: no send on create; explicit invite once, audited | db/hub-people · e2e/hub-stage1 | ✅ |
| C03 | Member can't edit others / read private contacts | db/hub-people · e2e/hub-stage1 | ✅ |
| C04 | Linking doesn't duplicate; 8+ posts, many teams | db/hub-people | ✅ |
| C05 | Public can't see directory/calendar (URLs, API, anon key) | db/hub-people · db/privileges · e2e/hub-stage5 | ✅ |
| H06 | Invite failure shown as not sent, retry | db/hub-people · e2e/hub-stage1 | ✅ |
| H07 | Expected manager gets no automatic requests | db/hub-people · e2e/hub-stage1 | ✅ |
| C08 | Mini Kickers in one short form, info-only | db/hub-calendar · e2e/hub-stage2 | ✅ |
| C09 | Three Saturday events independent | unit/hub-calendar · db/hub-calendar · e2e/hub-stage2 | ✅ |
| C10 | Away fixture at typed location, no venue | db/hub-calendar · e2e/hub-stage2 | ✅ |
| C11 | Freemens Way inactive, history viewable | db/hub-calendar · e2e/hub-stage2 · db/hub-rehearsal | ✅ |
| C12 | Kick-off only → "finish unknown" | unit/hub-calendar · db/hub-calendar · e2e/hub-stage2 | ✅ |
| H13 | Copy as new draft, nothing else copied | unit/hub-calendar · e2e/hub-stage2 | ✅ |
| C14 | Reschedule → reconfirm, stale reminders suppressed; cancel keeps history | db/hub-calendar · db/hub-availability · db/hub-notifications · e2e/hub-stage2 | ✅ |
| H15 | DST instants; nonexistent times refused | unit/hub-calendar · unit/london-time | ✅ |
| C16 | Yes → whole event, change to No, audited | db/hub-availability · e2e/hub-stage3 | ✅ |
| C17 | Partial times validated; unknown end handled | db/hub-availability | ✅ |
| C18 | Only asked people "not replied"; publish sends nothing | unit/involvement · db/hub-availability · e2e/hub-stage3 | ✅ |
| C19 | Reviewed recipient list; managers not included | db/hub-availability · e2e/hub-stage3 | ✅ |
| C20 | Bob confirmed only after accepting | db/hub-availability · e2e/hub-stage3 · e2e/hub-demo | ✅ |
| C21 | Steve declines; others unchanged | db/hub-availability · e2e/hub-stage3 · e2e/hub-demo | ✅ |
| C22 | Offline reply "recorded by organiser" | db/hub-availability · e2e/hub-stage3 | ✅ |
| C23 | Manager expected, not confirmed; one-event override | db/hub-availability · e2e/hub-stage3 | ✅ |
| C24 | Direct invite to manager with routine off | db/hub-availability | ✅ |
| H25 | Double clicks don't duplicate | db/hub-availability · db/hub-notifications | ✅ |
| C26 | One café cover over three events | db/hub-venue-cover · e2e/hub-stage4 · e2e/hub-demo | ✅ |
| C27 | Counted once; no clones | db/hub-venue-cover · e2e/hub-stage4 | ✅ |
| C28 | Change/cancel cover updates every event | db/hub-venue-cover · e2e/hub-stage4 | ✅ |
| C29 | Other venues not mixed | db/hub-venue-cover | ✅ |
| C30 | Different-place clash warned; same-venue allowed | db/hub-venue-cover · e2e/hub-stage4 | ✅ |
| C31 | Unknown end → cover at kick-off only | db/hub-venue-cover · e2e/hub-stage4 | ✅ |
| H32 | Unlock and lock as two venue assignments | db/hub-venue-cover | ✅ |
| C33 | Carl holds many; Filled + Seeking replacement; Extra help | db/hub-positions · e2e/hub-stage5 · e2e/hub-demo | ✅ |
| C34 | Shared role, two holders; succession dates | db/hub-positions | ✅ |
| C35 | Public opportunities are public-safe | db/hub-positions · e2e/hub-stage5 | ✅ |
| C36 | Public applicant submits full form; in admin inbox | db/hub-applications · e2e/hub-stage6 · e2e/hub-demo | ✅ |
| C37 | No auth account, login, role or invite for applicant | db/hub-applications · e2e/hub-stage6 · e2e/hub-demo | ✅ |
| C38 | Anon can't read/change private tables | db/hub-applications · db/privileges · db/security-audit · e2e/hub-stage6 | ✅ |
| C39 | Duplicates flagged, not merged | db/hub-applications · e2e/hub-stage6 | ✅ |
| C40 | Suggestions explained; safeguarding roles flagged | db/hub-applications · e2e/hub-stage6 | ✅ |
| C41 | Invalid input / no privacy tick refused; rate limits & bots | unit/application-form · db/hub-applications · e2e/hub-stage6 | ✅ |
| C42 | Under-18 diverted before personal details | unit/application-form · db/hub-applications · e2e/hub-stage6 | ✅ |
| H43 | Follow-up, possible role, trial without access | db/hub-applications · e2e/hub-stage6 | ✅ |
| H44 | Export, deletion, retention per configured policy | db/hub-applications · db/hub-notifications (export log) | ✅ mechanism; period awaits D5 |
| C45 | Mobile event form: essentials + "More options"; no template wizard | e2e/hub-stage2 | ✅ |
| C46 | Confirm/Decline in a couple of taps | e2e/hub-stage3 | ✅ |
| C47 | Overview separates Available/Confirmed/Expected/Pending/Declined honestly | unit/involvement · e2e/hub-stage4 · e2e/hub-demo | ✅ |
| H48 | axe WCAG 2.1 AA on 9 screens; 320px reflow; keyboard reach | e2e/hub-demo | ✅ (automated; a manual screen-reader pass is still worthwhile) |
| C49 | RLS on every public table; server checks; no secret in bundle | db/security-audit · db/privileges · unit/server-enforcement · e2e/hub-demo | ✅ |
| C50 | Messages only after deliberate actions | db/hub-notifications · e2e/hub-demo | ✅ |
| C51 | Migration keeps ids/history; rollback rehearsed; production untouched | db/hub-rehearsal · db/hub-people · db/hub-calendar | ✅ locally; staging run awaits D2 |
| H52 | Outbox idempotency, failure, retry | db/hub-notifications · db/outbox | ✅ |

Owner demo script (10 steps): `npm run e2e:demo` — 30/30 checks.
