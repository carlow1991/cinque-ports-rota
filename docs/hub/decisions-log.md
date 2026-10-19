# Volunteer Hub — decisions log

## A. Waiting for Carl (nothing below has been done to the live system)
| # | Decision | Default on the branch |
|---|---|---|
| D1 | Apply the 8 Hub migrations to the live project (align migration history first — runbook §2) | **Done 19 Oct 2026.** |
| D2 | Staging Supabase project (free tier) or accept local rehearsal | Local Postgres + fake Supabase only. |
| D3 | Freemens Way inactive | Migration sets it inactive; history kept; reactivate in Settings. |
| D4 | Real people, emails, team ↔ manager links (Scott, Danny, Matty) | Only fictional demo data (`supabase/seed-hub-demo.sql`). |
| D5 | Privacy notice text, legal basis, retention period, under-18 route, club contact email | Draft notice marked as draft (`PRIVACY_NOTICE_APPROVED=false`); no retention period (review date unset); under-18s told to contact the club with a parent/carer. |
| D6 | Which held posts recruit, which roles appear publicly | All flags off; "Add the usual roles" makes empty drafts. |
| D7 | Which events ask for availability, and who is routinely suggested | Per event, off by default; routine suggestions off per person. |
| D8 | Who are administrators / coordinators | Existing admin carried over; no one else. |
| D9 | Email domain/provider; turning email on | Unchanged: off until A3 in `docs/club-decisions.md`. |
| D10 | Merge `hub/volunteer-hub` and deploy | **Done 19 Oct 2026** (main @ 858d0bf). Rollback point `main` @ `98c0f6d`. |

## B. Decided pragmatically (documented, reversible)
**Identity & permissions**
- People keep the legacy volunteer ids; `volunteers` stays for history and the legacy functions, but access is now decided only from `people` + `user_accounts`.
- Only administrators create/edit people, send invitations and see applications; coordinators manage events for their venues/teams and see the directory with contacts.
- Under-18s: stored private, never listed to members, cannot be invited in V1.
- An invite within 2 minutes of a successful one isn't re-sent (double-click protection).

**Calendar**
- Event categories are a checked text column (not new enum values) so the migration stays in one transaction.
- Copies keep UK wall-clock times across clock changes; the repeated autumn hour uses the first (BST) occurrence; the skipped spring hour is refused with a clear message.
- Publishing only controls visibility; it never sends anything.

**Availability & assignments**
- Any signed-in member can offer availability on a help-wanted event; only people deliberately asked can be "not replied".
- Partial availability on an event without a recorded finish is kept and flagged for an organiser to check.
- A volunteer can withdraw from something they confirmed; the organiser sees it (and gets an email once email is on).
- One person card per event, in priority order: confirmed > expected > available > awaiting > declined.

**Venue cover**
- Venue cover is a single row; events derive whole / part / at-kick-off-only. Unknown finish never counts as full cover.
- A clash is only a different place at an overlapping time; saving anyway needs a written note.
- Changing a confirmed cover's times asks for reconfirmation unless the organiser records that the person agreed.

**Club roles & applications**
- Occupancy is derived from holders; recruiting flags are independent. Only public + recruiting roles appear on `/volunteer`, without names or contacts.
- The public form posts to a server route that calls a secret-key-only database function; the browser never sees the key and `anon` executes no function.
- Bots (honeypot / too-fast) get the same "received" answer and nothing is saved. Rate limits: 5 per hour per hashed client, 3 per day per contact.
- Possible duplicates are flagged, never merged. Suggested roles show their reasons; roles needing external safeguarding checks are flagged for human review.
- Application answers never go into the audit log; deleting an application leaves an audit line without contents.

**Notifications**
- Hub messages use the existing outbox (release gate, staging allow-list, demo suppression, re-check before send). Queued only after deliberate actions: availability requests, direct invitations, answers to organisers, reconfirmations, cancellations, day-before reminders, portal invites.
- Person/event/application creation and publishing never queue anything. No applicant acknowledgement email in V1.
- A recipient needs an email and an enabled linked account; otherwise the request is marked for manual contact.

**Legacy**
- Old rota/duty-template screens redirect to Hub pages unless `LEGACY_ROTA_UI=true`; legacy tables and data are untouched. The nine former duty types are only optional interest tags.

## B2. Independent security review (19 Oct 2026) — outcome
Lockdown confirmed sound (anon runs nothing, PUBLIC executes nothing, every definer function pins `search_path`, RLS everywhere, secret-key client server-only). Fixed in `20261019000800_hub_hardening.sql` (+ tested rollback, `tests/db/hub-hardening.db.test.ts`):
- **High:** disabling/demoting someone in the Hub left their legacy admin powers. Legacy identity and role now come from the Hub account; legacy-path volunteer changes are mirrored into the Hub; direct event writes withdrawn.
- **Medium:** members could read admin notes about themselves. Notes are now column-withheld; admins read them via `hub_person_notes`.
- Under-18s: hidden from coordinators' people picker and from ordinary members on event pages.
- Anonymising now also removes names from the audit history (Hub and legacy procedures).
- Public endpoint: client IP from Vercel's own header; safer error lookup.
Accepted as designed: coordinators can see a person's clash at another place when booking them; a team coordinator can create that team's events at any active venue; saving a date/time/place change asks confirmed helpers to reconfirm (C14) and cancelling notifies them — both only once email is switched on.

## C. Possible later improvements (not V1)
Calendar ICS feed; FA Full-Time fixture import; monthly admin digest; applicant acknowledgement email (separate setting); opportunity broadcasts; tasks/maintenance checklist; volunteer-hours report; inviting 16–17-year-olds with a parent/carer flow; per-team coordinator self-service for people; dropping legacy rota tables after a settled period (needs its own approval).
