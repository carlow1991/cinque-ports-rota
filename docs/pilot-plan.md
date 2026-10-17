# Recommended controlled pilot

**Recommendation:** don't open the rota to all volunteers at once. Run a **4-week pilot** on the live site, in **pilot mode** (`APP_ENV=pilot`), with a small group, while the club's existing way of organising duties carries on in parallel for the same weeks.

## Why
The app has been tested thoroughly by machine: 380+ automated tests and phone-width checks of every main journey. Three things can only be proven with real people and real accounts:
1. the club's real email domain and Supabase sign-in emails arriving (not in spam) on people's own phones;
2. the first Postgres 17 database (new Supabase projects use 17; the automated tests use 16);
3. whether the templates' suggested staffing numbers and wording suit the club in practice.

## Who
- **2 administrators** (e.g. Carl + one other officer).
- **1 coordinator per venue** (Marke Wood, Freemens Way).
- **8–12 volunteers**, mixing confident and less confident phone users, including at least one authorised site lead per venue and at least one person on Android and one on iPhone.

## What
- Weeks 1–4: put **every** event at both venues on the rota (fixtures, training, club events), using the templates.
- Organisers allocate pilot volunteers; pilot volunteers also sign up themselves.
- Deliberately try each of these at least once: an approval-required duty, a withdrawal, a late cancellation request, a postponed event (reconfirmation), a cancelled event, a venue-wide site lead covering linked fixtures, printing the day rota, marking attendance.
- Pilot mode: only the pilot group's addresses receive rota emails (`EMAIL_STAGING_ALLOWLIST`). Anyone else added by mistake gets nothing.

## Measures (review at the end of week 2 and week 4)
| Measure | Target |
|---|---|
| Pilot volunteers who signed in and took at least one duty without help | ≥ 80% |
| Rota emails delivered (Settings → Email: sent vs failed) | ≥ 98%, no `http 429` |
| Sign-in code emails arriving within 2 minutes, not in spam | All pilot members confirm |
| Events with site cover correctly shown (spot-check 5 against reality) | 5 / 5 |
| Wrong-person or privacy incidents (someone saw another's contact details, a wrong email) | **0** |
| "Something went wrong" screens reported | 0 unexplained |
| Organiser time to staff a matchday vs the current method | Same or less |

Collect feedback with three questions after week 2 and week 4: *What was confusing? What was missing? Would you use it instead of the current method?*

## Go / no-go for general release
**Go** when all targets are met, the access review (`privacy-and-access-review.md` §4) is done, the privacy notice is published, the first monthly export (`backup-and-recovery.md`) has been taken, and at least two admins have completed the handover checklist.

**Then:** set `APP_ENV=production`, remove the allow-list, redeploy, and invite everyone in batches of about 20 a day (this also keeps within Resend's free daily limit while invitations and first sign-ups settle).

**No-go:** fix what failed, then extend the pilot by 2 weeks. Any privacy incident stops the pilot until the cause is fixed and re-tested.
