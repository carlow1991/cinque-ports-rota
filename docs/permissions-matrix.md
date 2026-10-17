# Permissions matrix (Phase 2)

**Applies to:** migrations `…000100` to `…000600`.
**Enforcement:** every row below is enforced **in the database**, through RLS policies, column-level grants and checks inside each RPC. The app's page guards are a second layer and are not relied on.

| Symbol | Meaning |
|---|---|
| — | No access |
| R | Read |
| W | Write |
| own | The caller's own rows only |
| venue | Rows at venues the coordinator is assigned to |
| RPC | Change only through the named function, which re-checks every rule |

**Anonymous visitors** have no access to any table or function. **Suspended accounts** resolve to "no identity" everywhere, so they also get nothing, including their own past rows.

## Tables

| Table | Volunteer | Coordinator | Admin | Notes |
|---|---|---|---|---|
| `venues`, `teams`, `duty_types` | R | R | R, W (insert/update) | No deletes. Deactivate with `active=false`. |
| `club_settings` | R | R | R, W (cutoff, reminders) | Single row. |
| `volunteers` | R own; W own `display_name`, `phone`, `preferred_venue_id` | R own + volunteers with an active assignment at their venues (Q10) | R all; role/active via **RPC** `admin_set_volunteer_access` | Email, role, active flag and Auth link are never client-writable. |
| `coordinator_venues` | — | R own | R, W (insert/delete) | |
| `volunteer_duty_authorisations` | R own | — | R all; W via **RPC** `set_duty_authorisation` | Holds only a flag and an expiry. No DBS data. |
| `duty_templates`, `…_items`, `template_item_responsibilities` | — | R | R, W | Templates are deactivated, not deleted. |
| `events` | R non-draft | R non-draft + drafts at venue; insert **draft** at venue; update descriptive fields at venue | Same as coordinator, all venues | Times, venue, status and site-cover decisions change only by **RPC**. |
| `event_shifts` | R where event is visible | R; insert at venue; update `instructions` only | Same, all venues | Times, headcount and approval change via **RPC** `update_shift` and `cancel_shift`. |
| `event_shift_responsibilities` | R where visible | Insert/delete at venue, **only while nobody is committed** | Same, all venues | Changing them would change eligibility. |
| `assignments` | R own | R at venue | R all | **No direct writes for anyone.** RPCs only. |
| `cancellation_requests` | R own | R at venue | R all | RPCs only. |
| `notification_outbox` | — | — | — | Only the server email worker uses it, with the secret key. |
| `audit_log` | — | — | R | Written only by trigger. Email, phone and Auth ID are redacted. |

## RPCs (all `SECURITY DEFINER`; the caller is always taken from `auth.uid()`)

| Function | Who may call | Key checks inside the transaction |
|---|---|---|
| `self_signup(shift)` | Active volunteer | Event published · shift active, not started, sign-up on · authorised for primary **and every restricted included duty**, valid until shift end · capacity (`confirmed + pending < required`) · no overlap at any venue · rate limit · locks volunteer → shift |
| `accept_invitation(a)` / `decline_invitation(a)` | The invitee only | Same as sign-up on accept. Approval-required duties go to `pending_approval`, never straight to confirmed. |
| `withdraw_assignment(a)` | Owner | Only before the cutoff (default 24h) |
| `request_cancellation(a, reason)` | Owner | Keeps cover. Alerts admins and venue coordinators. |
| `allocate_volunteer(shift, vol)` | Coordinator (venue) / admin | Target active and eligible. Creates an invitation, which reserves no place. |
| `approve_assignment` / `reject_assignment` | Coordinator (venue) / admin | Re-checks eligibility, capacity and overlap |
| `remove_assignment(a, reason)` | Coordinator (venue) / admin | Reason required |
| `resolve_cancellation_request(req, approve)` | Coordinator (venue) / admin | |
| `mark_attendance(a, status)` | Coordinator (venue) / admin | Confirmed only, once the duty has started |
| `publish_event(e)` | Coordinator (venue) / admin | Has duties · explicit site-cover decision (own lead shift, link, provider/not-required) |
| `set_site_cover(e, source, note)` | **Admin** for provider/not-required (with note); coordinator may restore club cover | Records who verified it and when |
| `cancel_event`, `postpone_event`, `cancel_shift` | Coordinator (venue) / admin | Reason required · cascades to assignments · suppresses reminders · alerts dependants of venue cover |
| `reschedule_event`, `update_shift` | Coordinator (venue) / admin | Template shifts re-anchor · commitments reset to `invited` and are asked to reconfirm · headcount can't drop below committed |
| `complete_event(e)` | Coordinator (venue) / admin | Only after the end |
| `set_duty_authorisation(vol, duty, active, until)` | **Admin** | Alerts organisers if venue cover may be affected |
| `admin_set_volunteer_access(vol, role, active)` | **Admin** | Can't remove or demote the last active admin |
| `event_shift_staffing(e)` | Anyone who can see the event | Volunteers see counts and their own status. Invited counts are shown to organisers only. |
| `event_roster(e)` | Volunteers **on** that published event; organisers | **Names only** |
| `volunteer_picker(shift)` | Coordinator (venue) / admin | Names plus eligibility and clash flags. No contact details. |
| `event_site_coverage(e)` | Coordinator (venue) / admin | Full-window cover from confirmed, authorised leads |
| `manage_roster(from, to, venue, event)` | Coordinator (venue) / admin | Names, **phone** and status of people on duties; never email |
| `manage_action_queue()` | Coordinator (venue) / admin | Approvals, late cancellations, unanswered invitations |
| `event_cover_leads(e)` | Coordinator (venue) / admin | Site-lead names and authorisation state; provider cover has no name |
| `admin_create_volunteer(email, name, role)` | **Admin** | Normalised email, no duplicates, last-admin guard |
| `admin_set_coordinator_venues(vol, venues[])` | **Admin** | Coordinators only; atomic replace |
| `volunteer_rota`, `volunteer_event_view`, `my_duties` (Phase 4) | Any active volunteer | Own status and anonymous counts only |

**Function execute rights (Phase 4 fix):** every function in the database is locked by default; only the functions listed above can be called, and only by signed-in users (`tests/db/privileges.db.test.ts`).
**Elevated key:** the server-only secret key is used for one thing, sending an Auth invitation after `admin_create_volunteer()`, and only when `AUTH_INVITES_ENABLED=true`.

Internal helpers (`_has_overlap`, `missing_authorisations`, `_enqueue`, …) have **no** client execute grant.
