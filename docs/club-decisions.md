# Decisions and actions needed from the club

> **Volunteer Hub (Oct 2026):** the Hub redesign adds decisions D1–D10 in `docs/hub/decisions-log.md` (apply migrations, staging, Freemens Way inactive, real people and team links, privacy/retention/under-18 route, which roles recruit, deploy). B2 (withdrawal cut-off), B5 (authorisations) and B6 (template numbers) no longer apply: duty templates and staffing numbers are retired.

Everything the software can do is done and tested. What's left needs a person: a club decision, an account, a payment, or a click in a dashboard. Each has a suggested answer.

## A. Before staging/production (blocking)
| # | Decision / action | Suggested | Who |
|---|---|---|---|
| A1 | **Go-ahead to deploy**, first to staging, later production | Staging now; production after the staging smoke test passes | Carl |
| A2 | **Domain** for the rota, and who changes the club's DNS | `rota.<club-domain>` | Club officer with DNS access |
| A3 | **Email sending domain** (decision Q7): verify it in Resend (it shows the DNS records to add) and use it for Supabase's sign-in emails (custom SMTP) | `rota@<club-domain>`, Resend | Same DNS person + Carl |
| A4 | **Second administrator**: a named officer for the app, Supabase, Vercel, Resend and the password manager | Chairman or Secretary | Committee |
| A5 | **Account ownership**: club organisations/teams with role-address logins (`data-ownership-and-handover.md`) vs Carl's personal accounts | Club-owned | Committee |
| A6 | **Plans and cost.** Supabase production: Free (no backups, pauses after a quiet week) or **Pro, about $25/month** (daily backups, no pausing). Vercel: **Hobby** (free; schedule handled by Supabase; Vercel describes Hobby as for personal, non-commercial projects, so check it fits club use) or **Pro, about $20/month** (schedule in Vercel). Resend: free tier (100 emails/day) for the pilot | Supabase **Pro**; Vercel per budget; Resend free, reviewed after the pilot | Treasurer / Carl |
| A7 | **Staging project**: a second (Free) Supabase project for practice and future changes | Yes | Carl |
| A8 | **Pilot group**: names for the pilot (`pilot-plan.md`) | 2 admins, 2 coordinators, 8–12 volunteers | Committee |

## B. Before general release
| # | Decision | Suggested |
|---|---|---|
| B1 | **Privacy notice** (text in `privacy-and-access-review.md` §3) approved and published; Supabase, Vercel and Resend listed as processors | Approve with the club contact filled in |
| B2 | **Withdrawal cut-off**: how close to a duty volunteers can still withdraw online | 24 hours (current default; Settings) |
| B3 | **Day-before reminders** on or off | On (18:00 UK time) |
| B4 | **Retention periods** | Leavers anonymised on request or after 2 years inactive; audit history 24 months; email queue 90 days; exports 12 months |
| B5 | **Who holds club authorisations** (site lead, etc.) and their expiry | Committee list, renewed yearly |
| B6 | **Template staffing numbers** (T01–T09): review after the pilot | Adjust in Templates as needed. They are suggested defaults, not statutory or FA minimums |
| B7 | **Phone numbers on the printed day rota**: keep them (useful on the day) or hide them | Keep; printed sheets are binned securely |
| B8 | **Who runs the monthly export and the quarterly access review** | The two administrators, alternating |

## C. Dashboard steps only a person can do (in `deployment-checklist.md`)
Create the projects and Vercel import; copy keys into Vercel (never into chat); Supabase Auth settings (sign-ups off, URLs, email templates, SMTP); DNS records; the schedule (Vercel `vercel.json` or the Supabase SQL); inviting the first two admins with the script; switching email on after the admin test send.
