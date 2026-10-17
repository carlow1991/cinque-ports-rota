# Deployment approach

**Agreed 16 October 2026.** The rota uses the same stack as Carl OS: **GitHub, Vercel and Supabase**. It uses entirely separate accounts and resources, so nothing is shared with Carl OS.

**Status:** this is a plan only. **Nothing is deployed until Carl gives explicit approval at Phase 7.**

## Separation from Carl OS (non-negotiable)
| Resource | Carl OS | Cinque Ports rota |
|---|---|---|
| GitHub repo | `carlow1991/carl-os` | `carlow1991/cinque-ports-rota` |
| Supabase project | Carl OS project | **Separate club project** (already created by Carl) |
| Vercel project | Carl OS project | **New Vercel project** importing `cinque-ports-rota` |
| Env vars / keys | Carl OS's own | Own keys only. Carl OS values are never copied. |
| Domain | Carl OS's | Its own, e.g. `rota.<club domain>` (club decision) |

## How it fits together
```
GitHub (cinque-ports-rota)
  ├─ pull request / branch ──► Vercel Preview  ──► Supabase STAGING (or dev) project
  └─ main                   ──► Vercel Production ──► Supabase PRODUCTION project (the club project)
```

- **Vercel** imports the GitHub repo. Pushes to `main` deploy to production, and pull requests get preview URLs. The framework preset is Next.js, with the default build command.
- **Environment variables** are set separately for Production and Preview in Vercel. The variable names are in `.env.example`. `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` and the email API key are server-only. On Preview: `APP_ENV=staging`, `EMAIL_SENDING_ENABLED=false` or allow-list only.
- **Supabase:**
  - Migrations in `supabase/migrations` are applied with the Supabase CLI (`supabase link` then `supabase db push`). They are never edited by hand in the dashboard.
  - Auth Site URL is set to the production domain, and redirect URLs list **only** the production domain plus a specific staging URL. Wildcards are not used in production.
  - Public sign-ups are **disabled**, because the app is invite-only.
  - Custom SMTP is set up on the club's sending domain, for invites and OTP codes.
- **Scheduled worker** (outbox and reminders, from Phase 6): a Vercel Cron Job calls `/api/cron/outbox` with `CRON_SECRET`. ⚠ Check the frequency your Vercel plan allows. If it only allows daily runs, use Supabase `pg_cron` + `pg_net` to call the same secured endpoint every few minutes instead. Phase 6 outcome (D-606): changes send their own emails straight away, so the schedule only drives reminders and retries; every 5–15 minutes is ideal. The scheduler is chosen with Carl at Phase 7.

## Decisions still needed (before Phase 7)
1. **Staging database:** create a second Supabase project for staging and dev (recommended), or use local development only. Previews must never point at production data.
2. **Domain:** the subdomain for the rota, and who controls the club's DNS.
3. **Email sending domain and provider** (decision Q7).
4. **Second admin** for Vercel, Supabase and the app itself, so the club isn't locked out if one person is unavailable.
5. **Account ownership:** whether the Vercel and Supabase projects sit under Carl's personal accounts or a club-owned team/organisation, for handover.

## Phase 7 runbook (draft; executed only with approval)
1. Confirm the full test suite passes and the RLS review is done.
2. Run `supabase db push` to staging, apply seeds, and smoke-test the Vercel preview.
3. Configure production env vars in Vercel. Configure Supabase Auth URLs, SMTP, and sign-ups off.
4. Run `supabase db push` to production and apply the **non-demo** seeds only (venues, 9 duties, T01–T09).
5. Merge to `main`, so Vercel deploys to production.
6. Invite 2 admins, then the pilot group. Email sending stays off until a test send to admins is verified.
7. Confirm backups (Supabase plan backups / PITR), monitoring and error logs.
