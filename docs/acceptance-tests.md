# Acceptance tests (V1)

Each test has an ID, the phase that delivers it, and its layer: **U** = unit (Vitest), **D** = database (pgTAP/SQL), **E** = end-to-end (Playwright at a 375px viewport). Tests may only be reported as passing when the run output is shown.

## Auth & access (Phase 1–2)
| ID | Test | Layer |
|---|---|---|
| A01 | An unknown or uninvited email gets the same generic response, and no auth user is created. | E, D |
| A02 | An invited volunteer signs in by OTP, and the callback links `auth_user_id` by verified email. | E |
| A03 | Linking ignores any client-supplied volunteer id. | U |
| A04 | An inactive (suspended) volunteer cannot load any page or read any table, including the old rota. | E, D |
| A05 | A volunteer requesting `/manage/*` is denied server-side, including by a direct POST to a Server Action. | E |
| A06 | `anon` can select nothing from any table. | D |
| A07 | A volunteer cannot update their own `role`, `is_active`, authorisations, attendance or assignment status directly. | D |
| A08 | A volunteer cannot read another volunteer's email or phone by any route. | D, E |
| A09 | A coordinator at venue A cannot read drafts, mutate events or shifts, or allocate at venue B. | D |
| A10 | An unauthorised RPC call, whether by the wrong role or the wrong venue, fails without side effects. | D |

## Assignment integrity (Phase 2)
| ID | Test | Layer |
|---|---|---|
| B01 | Two concurrent signups for the last place: exactly one succeeds. | D (parallel connections) |
| B02 | The same volunteer signs up for two overlapping shifts at different venues concurrently: exactly one succeeds. | D |
| B03 | Back-to-back shifts (end equals start) are both allowed. | D |
| B04 | Lowering capacity during signup never results in overbooking. | D |
| B05 | An expired or inactive authorisation blocks a restricted duty, including an included responsibility (per Q4). | D |
| B06 | Approval-required: signup gives `pending_approval`, which reserves a place. Approve gives `confirmed`. Reject gives `declined`, which frees the place. | D |
| B07 | Invitation: an invite reserves no place. Accepting a full shift gives the error "Shift now full; please contact organiser". | D |
| B08 | Withdraw before the cutoff frees the place. Inside the cutoff, only a cancellation request is possible and cover is kept. | D |
| B09 | Invalid status transitions are rejected by the central transition function. | D |
| B10 | Cancelling an event cancels its shifts and active assignments, suppresses reminders and keeps history. | D |
| B11 | Rescheduling an event resets assignments to `invited` and frees provisional places. Re-accepting an approval-required shift gives `pending_approval`, never `confirmed`. | D |
| B12 | Every mutation writes an audit row and outbox row in the same transaction, so a rollback leaves neither. | D |

## Templates & coverage (Phase 3, 5)
| ID | Test | Layer |
|---|---|---|
| C01 | Exactly 9 duty types are seeded, with no `parking`. Re-running the seed changes nothing. | D |
| C02 | T01–T09 are seeded. Re-running the seed changes nothing. | D |
| C03 | **T01 with gate and refreshments enabled gives exactly 5 shift rows and 8 slots.** The site lead row has `open_unlock`, `facility_checks` and `lock_secure` as responsibilities. | U, D |
| C04 | T01 default gives 3 rows and 5 slots. | U, D |
| C05 | **T03 linked to a confirmed covering lead gives no site-lead row**, 2 setup slots and 1 cleaning slot. | D |
| C06 | T03 not linked with `site_responsibility=true`: publishing is blocked with a clear message until there is a lead, link or recorded external decision. | D, E |
| C07 | **T09 gives exactly 1 composite site-lead row.** | U, D |
| C08 | A disabled optional item gives no row, no vacancy and no warning. | U, D |
| C09 | Offsets are correct for before-start, after-end and mixed anchors. | U |
| C10 | DST: an event on 25 Oct 2026 at 01:30 BST/GMT, and on 29 Mar 2026, give correct absolute shift times and local display. | U |
| C11 | Cross-midnight shifts are valid and display on the correct local dates. | U |
| C12 | A coverage link to another venue, a non-coverage event, itself, or a cycle is rejected. | D |
| C13 | Catalogue §6 example: the lead cancels, so **both** linked events show "Venue cover at risk" and organisers get an outbox alert. Setup and cleaning assignments are unchanged. | D, E |
| C14 | A lead covering only part of the window: the gap interval is reported, and the event is not shown as covered. | U, D |
| C15 | A provider-verified event displays differently from a volunteer-confirmed one, and shows no invented name. | E |
| C16 | A split site-lead handover with no gap is covered. A handover with a gap reports the gap. | U |
| C17 | Composite shifts count once in headcount and on the dashboard. | D |
| C18 | Overlapping events at one venue, and simultaneous events at both venues, all display. | E |
| C19 | Deleting or deactivating a template never deletes historic shifts. | D |

## Volunteer UX (Phase 4)
| ID | Test | Layer |
|---|---|---|
| V01 | Sign in and sign up on a phone in under 1 minute (scripted path). | E |
| V02 | No horizontal scroll at 375px. Keyboard-navigable. Status is never conveyed by colour alone. | E |
| V03 | Success is shown only after commit. A server error shows a plain-English message. | E |
| V04 | The event roster shows names only, and only for the same published event. | E |

## Email (Phase 6)
| ID | Test | Layer |
|---|---|---|
| M01 | A retry does not duplicate an email (dedupe key). | D, U |
| M02 | A demo event never sends. A non-production environment sends only to allow-listed recipients. | U |
| M03 | The reminder targets the correct UK local day around DST. It is suppressed if the assignment or event is inactive at send time. | U, D |
| M04 | Email bodies contain no roster or other people's contact details. | U |
