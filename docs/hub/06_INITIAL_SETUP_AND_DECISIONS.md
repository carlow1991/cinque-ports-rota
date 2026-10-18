# 06 — Club Configuration, Demonstration Scenarios & Decision Log

## 1. Initial club settings (explicitly requested)
- Organisation: Cinque Ports FC.
- Branding tagline: `One Club. One Community. Together.`
- Locale: en-GB, Europe/London, 24-hour time, date format DD/MM/YYYY.
- Working venue: `Marke Wood` — active.
- Retained future venue: `Freemens Way` — inactive; do not remove or show as default new-event choice.
- Calendar contains **all** club events, including away matches and external club meetings, even if no volunteering is needed.
- Public recruitment and application page: no login, independent of private dashboard.
- Keep existing domain and authentication if valid; do not assume website is publicly readable by coding agent without repository access.

## 2. People initially discussed (names only; admin must verify actual identities/contact details)
| Person | Type suggested | Routine availability requests | Portal access | Event association |
|---|---|---|---|---|
| Kelly | volunteer / café cover | yes | optional invitation by admin | Venue-wide café cover when specifically allocated |
| Adam | volunteer | yes | optional invitation by admin | As needed |
| Riley | volunteer | yes | optional invitation by admin | As needed |
| Bob | volunteer / club official | yes | optional invitation by admin | Can be directly asked to support Ladies fixture |
| Steve | volunteer / club official | yes | optional invitation by admin | Can be directly asked to support Ladies fixture |
| Scott | manager | no routine requests | optional | Expected on his team fixtures when mapped |
| Danny | manager | no routine requests | optional | Expected on his team fixtures when mapped |
| Matty | manager | no routine requests | optional | Expected on his team fixtures when mapped |

**Do not auto-create real records, send messages or assume which specific teams Scott, Danny and Matty manage.** Use as labelled demo/test data only until owner checks mappings.

## 3. Roles user reports currently covering
Club Secretary, Senior Secretary, Youth Secretary, Groundsman, Social Media, Finance, Vice-Chairman, Welfare Officer, and other responsibilities. These are **proposed directory draft records** from the user's own description, not verification of formally registered appointments. Do not mark these as vacant automatically. Allow each to show current holder while flagging replacement and/or extra assistance, according to owner's selected priorities. Safeguarding/welfare appointment status must be verified against club/FA registration processes.

## 4. Test Saturday schedule (illustrative, NOT real fixtures)
Marke Wood:
- Mini Kickers 09:00–11:00
- Youth games begin between 09:00 and 12:00; create a representative event block with explicit end for tests
- Veterans kick off 10:30 (use known fixture end only if admin enters it)
- Kelly café shared venue cover 09:00–13:00 (example time; not a real assignment)

After confirmation, Kelly should appear one time in venue-day cover, and as contextual support for relevant overlapping events. One actual assignment only.

## 5. Test direct assignment
- Create example Ladies match at Marke Wood (or external venue).
- Invite Bob for 'Matchday support'; state Pending until he accepts.
- Invite Steve for 'Matchday support'; state Pending then Declined.
- Create Expected by role manager for the Ladies team only if admin supplies accurate association; never invent it.

## 6. Initial nine interest/responsibility tags (not mandatory templates)
1. Site lead / duty manager
2. Open and unlock facilities
3. Lock and secure facilities
4. Gate / admission collection
5. Refreshments / tea bar
6. Pitch and equipment setup
7. Changing room / facility checks
8. Post-event cleaning
9. General volunteer support
Additional skills may be recorded freely (socials, finance, coaching, sponsorship, pitch marking etc.).

## 7. Questions Claude Code should resolve from repo automatically (do not ask user unnecessarily)
- Existing framework, auth, database, migrations, emails and route names.
- Existing volunteer record field names, team references, old shift data and send-notification triggers.
- Domain and environment separation as configured in code.
- What existing components can be reused cleanly versus safely hidden behind a feature flag.

## 8. Genuine decisions requiring owner input only when implementation reaches them
- Verify names/emails and teams for real invitations (cannot guess).
- Verify club privacy notice text, legal basis and retention schedule, and club contact handling under ICO rules.
- Choose and authorise operational administrators/coordinators and which contacts/roles may be displayed publicly.
- Which held positions are actively seeking a successor and which need additional help; these flags must be set by admin, not assumed.
- Which events should trigger availability requests and exactly who should receive them.
- Approve real sending domain/provider and staging to production deployment.
- Confirm safeguarding-specific approved process and under-18 application contact route.

All other small UX/engineering defaults should be decided pragmatically by Claude, documented and implemented on staging without blocking on repeated questions.

## 9. Launch checklist
- [ ] Current production snapshot taken and validated.
- [ ] New RLS and server authorisation tests passing.
- [ ] Current user/person mapping audited, duplicate cases reviewed.
- [ ] All venue and team association data verified by admin.
- [ ] Unknown end-time and shared coverage test cases passing.
- [ ] Public privacy policy content and retention settings approved.
- [ ] Public form spam protection and under-18 handling verified.
- [ ] Email templates reviewed and delivery provider verified with staging addresses.
- [ ] Real invitations have not been sent until approved.
- [ ] Old mandatory duty-template screens no longer in normal navigation.
- [ ] All C-numbered acceptance tests completed.
- [ ] Rollback plan documented and tested.
- [ ] Final staging walkthrough and production deployment authorised.

## 10. Future possibilities — explicitly NOT V1 obligations
Calendar ICS subscription, FA Full-Time fixture synchronisation, monthly admin digest, volunteer opportunity broadcasts, Tasks/maintenance checklist, additional file uploads, volunteer-hours reports, Carl OS reporting link, richer member availability preferences. Add only if real usage justifies their administration and maintenance cost.
