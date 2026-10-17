# Data ownership and administrator handover

## Who owns what
The **club** owns the rota, its data and its accounts. No individual should be the only way in.

| Asset | Recommended owner | Minimum access holders |
|---|---|---|
| GitHub repo `cinque-ports-rota` | Move to a **club GitHub organisation** (free), or keep under Carl's account with a second named collaborator with admin rights | 2 |
| Supabase organisation + projects (production, staging) | A **club Supabase organisation**; billing on a club card | 2 owners |
| Vercel project | A Vercel **team** for the club (Pro is per-member: one paying owner is enough), or Carl's account with a documented transfer plan | 2 (or 1 + transfer plan) |
| Resend account + sending domain | Club account, signed up with a **club role address** (e.g. `rota@<club-domain>`) | 2 |
| Domain / DNS (`rota.<club-domain>`) | Whoever controls the club domain | 2 |
| Rota app administrator role | Club officers | **At least 2 active admins** (the app refuses to remove the last one) |
| Monthly backup exports | Club access-controlled storage | 2 |
| Secrets (keys, `CRON_SECRET`, database password) | The club's password manager (shared vault) | 2 |

Sign each account up with a **club role address** (e.g. `rota-admin@<club-domain>`), not a personal email, so access survives a change of officer. Two-factor authentication on for everyone.

## Handing over to a new administrator (checklist)
When an admin steps down, or before Carl hands over:
- [ ] New admin added in the app: Volunteers → Add (role *Admin*). Confirm they can sign in.
- [ ] New admin added to the password manager vault, GitHub, Supabase, Vercel and Resend (with two-factor authentication).
- [ ] Walk them through `admin-guide.md` (30 minutes) and `deployment-checklist.md` "If something goes wrong".
- [ ] They do one monthly export (`backup-and-recovery.md`) with you watching.
- [ ] They run one quarterly access review (`privacy-and-access-review.md` §4).
- [ ] Departing admin: remove their app admin role (or suspend them), remove them from every platform account, and rotate any key they held a copy of.
- [ ] Record the handover date in the committee minutes.

## What a successor needs to know
- **The code** lives in GitHub. Every change goes through Git; Vercel deploys `main` automatically. `docs/build-progress.md` explains the design and `docs/decisions.md` explains each decision.
- **The database structure** is only ever changed by adding a new file to `supabase/migrations/` and running `supabase db push`. Never edit tables by hand in the dashboard, except the documented SQL in `docs/sql/`.
- **Tests:** `npm run lint`, `npm run typecheck`, `npm test` (needs a local PostgreSQL, see `setup.md`), and the phone checks in `tests/e2e/`.
- **The rota has no hidden dependency on Carl OS** or any other project.
- **Costs** to budget for (club decision A6): Supabase Pro (about $25 a month) if chosen; Vercel Hobby (free) or Pro (about $20 a month per member); Resend's free tier (3,000 emails a month, **100 a day**, one sending domain) is enough for the pilot, but a busy matchday after general release (reminders plus a postponement to 40+ people) could hit the daily cap, so review the Email card after the pilot and move to a paid Resend plan if failures show `http 429`; the domain renewal. Check current prices at sign-up.

## If the club stops using the rota
1. Do a final export (`backup-and-recovery.md`) and keep it only as long as the retention policy says.
2. Set `EMAIL_SENDING_ENABLED=false`; remove the schedule (Vercel cron or `select cron.unschedule('rota-outbox');`).
3. Delete the Vercel project, the Supabase projects, the Resend domain and the DNS record.
4. Tell volunteers, and delete the final export when its retention period ends.
