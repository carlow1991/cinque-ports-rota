# Cinque Ports FC — V1 Duty Catalogue and Venue/Event Templates
**Approved catalogue update:** 16 October 2026  
**Applies to:** Marke Wood and Freemens Way  
**Status:** Proposed operational defaults for the club to approve before production; **not statutory, FA, or grounds-safety minimum headcounts**. Each event's organiser can edit the numbers and timings based on club policy, expected attendance, the venue's operating arrangements and risk assessment.

## 1. Design objectives

1. Nine named duty types — no extra Parking or generic Steward role in V1.
2. Distinguish **venue-wide cover** (who opens, is responsible for the site, checks facilities and locks up) from **event-specific cover** (gate, refreshments, setup and cleaning).
3. A single assigned shift can include multiple **responsibilities**, such as Site Lead + Open/Unlock + Facility Checks + Lock/Secure. This is **one volunteer assignment**, not four vacant positions.
4. Split responsibilities into separate shifts when different people or different times are needed. V1 blocks any *overlapping separate shifts for the same volunteer*; do not introduce hidden double-booking exceptions.
5. A requirement that is not relevant (no admissions, no refreshments, facilities managed by provider) is explicitly switched off — it should not appear as an unfilled vacancy.
6. These templates cover **facility/event support only**. Managers, coaches, first-aiders, match officials and youth safeguarding oversight are outside the duty catalogue and must be separately arranged as required by club/FA rules. Do not infer that a site lead substitutes for a youth coach or safeguarding-qualified official.

## 2. Canonical duty catalogue — seed exactly these nine

| Stable code | Display label | Typical slots per active shift | Default policy and operational notes |
|---|---|---:|---|
| `site_lead` | Site lead / duty manager | 1 | Named accountable contact for the staffed operational window; authorised/trained by club; can be assigned opening, facility checks and closing as included responsibilities. |
| `open_unlock` | Open and unlock facilities | 1 | Keyholder/authorised-access role; may be included within the site-lead shift when that volunteer attends from opening. |
| `lock_secure` | Lock and secure facilities | 1 | Keyholder/authorised-access role; may be included within site-lead shift when that volunteer stays until closing. |
| `gate_admissions` | Gate / admission collection | 1 normally; 2 for busier admission periods | Add **only where admission is actually taken**; record cash-handling instructions privately with authorised organiser. |
| `refreshments` | Refreshments / tea bar | 1 for quieter sessions; 2 for first-team/busy event | Add only where the bar is operating; assess need for breaks/food-handling and safe cash procedures. |
| `pitch_setup` | Pitch and equipment setup | 1–2 normally, 3 for larger multi-area setup | May include pitch marking/equipment preparation in organiser instructions if relevant, but do not use as substitute for specialist maintenance qualification. |
| `facility_checks` | Changing room / facility checks | 1 | Ideally included within site lead's shift if appropriate; split off if repeated rounds or separate access/security responsibilities are needed. |
| `cleaning` | Post-event cleaning | 1–2 normally; 3 for larger events | Starts at planned event/operational end, with time for cleanup and waste removal; additional specialist tasks require separate arrangements. |
| `general_support` | General volunteer support | 1–2 normally, 2–4 for a work party | Describe actual tasks in shift instructions (e.g. helping organise a community day); avoid an ambiguous empty label. |

**Duty authorisation:** `site_lead`, `open_unlock`, `lock_secure` should default to requiring a club-issued authorisation. Other duty types may be configured as restricted by administrators depending on the specific role, activity, supervision and venue. This flag is *not* a determination of DBS eligibility. Keep DBS/safeguarding evidence in the club's approved external process; V1 stores only a boolean eligibility/expiry set by an authorised official.

## 3. Template mechanics and shift defaults

- Fixture `event.starts_at` represents scheduled event start (normally kickoff); `event.ends_at` is its planned end. **Never hard-code a match as 90 minutes including pre/post tasks.** Administrators must set a realistic event-end window.
- Define `duty_template_items.start_anchor` and `.end_anchor` as `event_start` or `event_end`, with corresponding minute offsets (positive or negative). Example: `event_start - 60 min` to `event_end + 30 min`.
- Each template item has: primary duty type, `required_count` (>=1), `enabled_by_default`, `when_to_enable` guidance, start/end anchors and offsets, signup/approval policy, instructions, and zero or more included secondary responsibility duty types.
- Optional items are stored in the template as **disabled by default**; they only become event shifts after the organiser explicitly enables them. Never create 0-headcount phantom rows.
- Venue-wide coverage is an event with `event_type=venue_coverage`. Other events may link to it if **same venue** and the lead's confirmed shift actually covers the relevant operational window. Events with linked, adequate coverage suppress their duplicate site-lead/open/lock/check requirement. Do not silently suppress if the linked lead becomes unconfirmed, time changes, or shifts stop covering the required window: show a prominent venue coverage warning.
- If site operations are actually provided by a third party, allow an admin to record **externally covered, verification note and who confirmed it**. Label this differently from `volunteer-confirmed`; do not pretend to know the name/attendance of an unregistered provider.
- The primary duty plus included responsibilities form **one scheduled assignment and one volunteer-counted staffing slot**. Included responsibilities appear in the volunteer's duty detail and printable organiser rota. They are *not* separately counted as vacancies.
- Never assign one person to overlapping independent shifts in V1. If someone will cover concurrent duties, use a single composite shift; otherwise split into genuinely nonoverlapping shifts (e.g. setup then cleaning). Do not allow one person to satisfy two simultaneous required volunteer headcounts.
- Avoid duplicating open/close duties for each of multiple fixtures on the same day; model shared operations once per venue session.

## 4. Template list and recommended staffing

Notation: `1` = one separate shift slot; `2` = two slots; `optional` = disabled by default until needed; `included` = responsibility of the primary site-lead shift, not another assignment. All counts are **assignment slots across shifts**, **not unique people**. Volunteers may cover multiple nonoverlapping shifts.

### T01 — Marke Wood: First Team home fixture

**Default event duties:**

| Duty | Slots | Default / timing | Notes |
|---|---:|---|---|
| Site lead / duty manager | 1 | Event start −75 min → event end +45 min | **Required unless fully covered by linked venue-wide session**; include `open_unlock`, `facility_checks`, `lock_secure` if same person can handle all. |
| Open and unlock | Included | At opening | Create separate 1-person early shift instead if site lead is not opener. |
| Lock and secure | Included | After cleanup | Create separate 1-person closing shift instead if site lead is not closer. |
| Gate / admission collection | 1 | **Optional:** start −45 min → start +20 min | Enable if admissions being collected; adjust for arrivals. |
| Refreshments / tea bar | 2 | **Optional:** start −45 min → end +30 min | Enable when tea bar operates; reduce to 1 for quieter matches. |
| Pitch and equipment setup | 2 | Start −75 min → start −15 min | Required by default; scale down if preparation already arranged. |
| Changing room / facility checks | Included | Before use and before handover | Split into 1 standalone shift if needed. |
| Post-event cleaning | 2 | End → end +45 min | Required by default; adjust for usage. |
| General volunteer support | 1 | **Optional:** start −30 min → end +15 min | Clearly describe the actual task. |

**Default core:** 1 site-lead + 2 setup + 2 cleaning = **5 time-specific shift slots**. If gate and refreshments both operate: **8 shift slots**; people needed simultaneously varies by time and shift overlap. The club can choose a fuller staffing model based on demand and risk.

### T02 — Marke Wood: Other adult home fixture (Reserves, Ladies, Veterans, Sunday)

| Duty | Slots | Default / timing |
|---|---:|---|
| Site lead / duty manager | 1 | Start −60 min → end +30 min; include open, facility checks, lock unless shared venue coverage is linked |
| Pitch and equipment setup | 1 | Start −45 min → start −10 min |
| Post-event cleaning | 1 | End → end +30 min |
| Refreshments / tea bar | 1 optional | Start −30 min → end +15 min; enable only if operating |
| Gate / admission collection | 1 optional | Start −30 min → start +15 min; enable only if collecting admission |
| General volunteer support | 1 optional | Task-based |

**Default core:** 3 shift slots across the event. No assumption that gate or refreshments are provided.

### T03 — Freemens Way: Youth fixture block (e.g. U7/U9 morning)

| Duty | Slots | Default / timing |
|---|---:|---|
| Site lead / duty manager | 1 venue-wide | Create/link a venue coverage event covering actual opening, session and close. Add **only if no adequate existing coverage**; include open/facility checks/lock as appropriate. |
| Pitch and equipment setup | 2 | Start −45 min → start (multiple areas/equipment) |
| Post-event cleaning | 1 | End → end +30 min; raise to 2 if facilities heavily used |
| Refreshments / tea bar | 1 optional | Start −15 min → end +15 min; raise to 2 if busy |
| General volunteer support | 1 optional | During event; specify help required |
| Gate / admission collection | 0, off | Not normally enabled for this template unless club explicitly collects admissions |

**Default core:** 2 setup + 1 cleaning + **1 shared site lead if required and not already covered**. Staff operating football activities and child safeguarding are NOT represented by these rota slots.

### T04 — Freemens Way: Adult home fixture

| Duty | Slots | Default / timing |
|---|---:|---|
| Site lead / duty manager | 1 | Start −60 min → end +30 min, only if not linked to adequate shared venue coverage; include open/check/lock if relevant |
| Pitch and equipment setup | 1 | Start −45 min → start −10 min |
| Post-event cleaning | 1 | End → end +30 min |
| Refreshments / tea bar | 1 optional | Only if operating |
| Gate / admission collection | 1 optional | Only if collecting admissions |
| General volunteer support | 1 optional | Only if defined task exists |

**Default core:** 2 event-specific slots and 1 site lead if required/not already shared.

### T05 — Training session: Either venue

| Duty | Slots | Default / timing |
|---|---:|---|
| Site lead / duty manager | 1 conditional | Only if club is responsible for the facility and no adequate linked venue coverage exists. If a provider manages it, record external coverage with reason/verification. |
| Pitch and equipment setup | 1 optional | Start −15 min → start |
| Post-event cleaning | 1 optional | End → end +15 min if venue requires club clean-down |
| Open / facility checks / lock | Included conditionally | In site-lead shift if club has these responsibilities |

**Default:** no automatic requirement for event-specific setup or cleanup until venue arrangements are checked. The team coach is **not** automatically the site lead. The event cannot be published without an explicit site-coverage decision when club site responsibility applies.

### T06 — Multi-fixture day / shared venue operations: Either venue

**Apply this template to one `venue_coverage` event for the full active window, never once per individual match.**

| Duty | Slots | Default / timing |
|---|---:|---|
| Site lead / duty manager | 1 per concurrent coverage window | Full venue operational period; include open, checks and lock if same person performs them |
| Open and unlock | Included or 1 separate | Only if a different keyholder opens |
| Lock and secure | Included or 1 separate | Only if a different keyholder closes |
| Changing room / facility checks | Included or 1 separate | Separate if prolonged use requires additional checks |
| Refreshments / tea bar | 2 optional | Activate if shared refreshment service operates |
| Gate / admission collection | 1 optional | Activate only if central entry/admission collection occurs |
| General volunteer support | 1 optional | Shared help across venue if meaningful |

**Fixture-specific setup and cleaning stay on each fixture** unless an organiser deliberately creates one clearly defined shared setup/cleaning block instead. A site lead may hand over midway: split the site-lead duty into nonoverlapping shifts and show any uncovered gap.

### T07 — Club event / community / fundraising: Either venue

| Duty | Slots | Default / timing |
|---|---:|---|
| Site lead / duty manager | 1 | Start −60 min → end +45 min; include open/check/lock as appropriate |
| Pitch and equipment setup | 2 | Start −60 min → start −10 min; instructions specify tables/signage/equipment |
| General volunteer support | 2 | Event period, with explicit task notes |
| Post-event cleaning | 2 | End → end +45 min |
| Refreshments / tea bar | 2 optional | Only if operating |
| Gate / admission collection | 1 optional | Only if ticketed/admission collection |

**Default core:** 7 shift slots over time, which does not mean seven distinct volunteers simultaneously.

### T08 — Maintenance / working party: Either venue

| Duty | Slots | Default / timing |
|---|---:|---|
| Site lead / duty manager | 1 | Full session; include unlock/check/lock if relevant |
| General volunteer support | 3 | Start → end (scale 2–4); instructions specify physical tasks and equipment |
| Post-event cleaning | 1 | End → end +30 min |
| Pitch and equipment setup | 1 optional | When preparatory equipment setup is actually needed |

**Default core:** 5 shift slots. Specialist jobs (electrical, machinery, heights, pitch treatment etc.) must use appropriately competent persons, risk assessment and separate club safety procedures; the rota is not a qualification system.

### T09 — Venue opening / closing coverage: Either venue

| Duty | Slots | Default / timing |
|---|---:|---|
| Site lead / duty manager | 1 | Entire operational period, if one person really is responsible for that window |
| Open and unlock | Included or 1 standalone | Opening window; only separately allocated if not included |
| Changing room / facility checks | Included or 1 standalone | As defined in the site checklist |
| Lock and secure | Included or 1 standalone | Closing window; only separately allocated if not included |

**Default core:** 1 composite lead assignment covering opening to closing. If no one can remain responsible for the whole period, the organiser must split the lead period (and allocate opening/closing to the relevant authorised people). Do not invent full-day coverage from a person who only comes to unlock.

## 5. Practical assignments and staffing principles

- For each event show **required slots**, **confirmed**, **pending approval**, **invited (not covering)**, and **vacancies**. A volunteer in one composite shift counts **once**, no matter how many tasks the shift includes.
- The day view should show a **time-axis coverage graph** and the **unique confirmed volunteer roster at each moment**, because summing all shift slots gives a misleading impression of people physically available throughout the day.
- An event only shows **Site operations covered** when the linked venue-coverage event has a confirmed, authorised site lead across the required operational interval; missing/conflicting segments must be highlighted. Linking to an event alone is not proof of cover.
- If one person is doing early setup and later cleaning, create two nonoverlapping shifts and allow that volunteer to take both. If the periods overlap, adjust the timing or use a single composite shift if the duties are genuinely manageable together; do not silently override conflicts.
- An organiser can toggle optional items on when creating an event. A disabled optional item does not appear as an empty duty and does not trigger an alert.
- Volunteer-facing roles requiring keys/cash/access or other training cannot be claimed without club-authorised eligibility. Children’s activities must be supported by separate appropriate coaching/safeguarding arrangements; the rota must not describe administrative/site presence as a safeguarding qualification.

## 6. Example: concurrent fixtures at Freemens Way

Example ONLY (no actual club fixture claim):
- Create one venue coverage event, `Freemens Way Saturday operations`, 08:00–14:00. One authorised site lead is confirmed to its 08:00–14:00 composite shift, with open/lock/facility checks included.
- Create `Youth fixture block`, 09:00–12:00, link to the above coverage event. Generate its 2 pitch-setup slots and 1 cleaning slot; optionally enable refreshments.
- Create `Additional club activity`, 12:00–13:30, also link to the same coverage event. Its site-lead duty must **not** be duplicated; only task-specific shifts are generated.
- If the 08:00–14:00 lead cancels, both linked activities visibly switch to `Venue cover at risk`, and organisers are notified. Their pitch-setup and cleaning assignments remain unchanged.

## 7. Seed / UI / validation acceptance criteria

1. Seed exactly nine canonical `duty_types` named in section 2 and T01–T09 editable templates. No Parking duty or duplicate duty codes. Seed is idempotent and uses stable codes (not translated labels) as identities.
2. A template shows primary role, included duties, timing anchors, number required and `Enabled by default` toggle. Organisers preview generated shifts and can customise before publishing.
3. Applying T01 with gate and tea bar enabled produces exactly 5 independently countable shift rows (site lead, gate, refreshments, setup, cleaning) and 8 slot headcount across those rows. The site lead's open/check/lock appear as included responsibilities, **not** three additional vacant shifts.
4. Applying T03 where linked venue coverage is confirmed creates 2 pitch-setup slots and 1 cleaning slot, with **no duplicated site-lead vacancy**. If no cover is linked and club is responsible for the site, require a real site-lead shift or block publication with a clear warning.
5. Applying T09 produces **one** composite site-lead shift for default setup; split it into separate meaningful shifts if venue handover is needed.
6. A volunteer cannot be counted twice in concurrent headcounts: two overlapping independent assignments are rejected even in the same venue. Sequential shifts are permitted.
7. A disabled optional gate/tea-bar item does not create an empty vacancy or negative coverage warning.
8. If a linked venue lead becomes unconfirmed, is rescheduled, loses authorisation or leaves a coverage-time gap, all affected events show a coverage warning and the appropriate organiser receives an alert.
9. Both venues can host simultaneous events; linking works only within the same venue and requires actual time-window coverage.
10. Permissions remain intact: only authorised club admins/coordinators can change template defaults or override external-coverage decisions; volunteers cannot self-authorise keyholder or restricted roles.

## 8. Reference policies

- Club staffing numbers and operating plans require confirmation by the relevant club organiser before a template is first used live.
- The FA safer recruitment / DBS guidance: https://www.thefa.com/football-rules-governance/safeguarding/section-3-safer-recruitment-and-dbs-checks
- The FA 2026/27 affiliation/safeguarding declarations and requirements: https://grassrootstechnology.thefa.com/support/solutions/articles/48001239436-safeguarding-declarations
- Do not use this duty catalogue to replace appropriate coaching, welfare, first-aid or grounds-safety arrangements.
