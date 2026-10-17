# Deployment checklist (staging, then production)

**Status:** prepared in Phase 7. **Nothing here has been run.** Each part starts only when Carl says so.
**Stack:** GitHub `carlow1991/cinque-ports-rota` → Vercel → Supabase, fully separate from Carl OS (`deployment-approach.md`).
**Rule for keys:** keys go only into the Supabase/Vercel dashboards or a local `.env.*.local` file. Never into chat, email, or Git.

Tick each box as you go. If anything fails, stop: don't improvise on the production database.

---

## 0. Before starting
- [ ] The club decisions in `club-decisions.md` §A are made (staging project, domain, email domain, two admins, account ownership, Supabase/Vercel plans).
- [ ] The latest `main` passed the full test run (`test-report-phase-7.md`).
- [ ] Two people can sign in to the Supabase **and** Vercel accounts (or the club team/organisation) with two-factor authentication on.

## 1. Staging (practice run, with no real volunteers)

### 1.1 Supabase staging project
- [ ] Create a **new** project, e.g. `cinque-ports-rota-staging`. Region: **London (eu-west-2)**. Save the database password in the club's password manager.
- [ ] Project Settings → API keys: note the Project URL, **publishable** key and **secret** key (for Vercel, step 1.4).

### 1.2 Apply the database
From a computer with this repo (Node 20+):
```bash
npx supabase@2 login
npx supabase@2 link --project-ref <STAGING-REF>
npx supabase@2 db push --dry-run     # lists the 16 migrations; nothing applied yet
npx supabase@2 db push
```
- [ ] Check in the dashboard → Table editor: `duty_types` has **9** rows, `duty_templates` has **9** (T01–T09), `venues` has **2**, and `events` is **empty**.
- ⚠ **Never** run `supabase db reset --linked`, `supabase config push`, or anything with `--include-seed` against staging or production. (The demo seed is switched off in `supabase/config.toml` and refuses to load next to real events anyway.)
- ℹ New Supabase projects run **Postgres 17**. The automated tests run on 16, and the CLI push was rehearsed locally. This staging push is the first real PG17 run, so do it before production.

### 1.3 Supabase Auth settings (dashboard → Authentication)
- [ ] **Sign In / Providers:** *Allow new users to sign up* **off**. Email provider on. Confirm email on.
- [ ] **URL Configuration:** Site URL = the staging address (e.g. `https://cinque-ports-rota-git-staging-….vercel.app` or `https://rota-staging.<club-domain>`). Redirect URLs: exactly `<staging address>/auth/callback`, no wildcards.
- [ ] **Email templates:** paste the *Magic link* and *Invite user* bodies from `setup.md` §3.
- [ ] **SMTP:** configure custom SMTP on the club's sending domain (`club-decisions.md` A3). Until then Supabase's built-in mailer allows only a handful of emails per hour, which is enough for staging, not for the pilot.

### 1.4 Vercel project
- [ ] Vercel → Add New → Project → import `carlow1991/cinque-ports-rota`. Framework: Next.js (defaults). **Don't deploy yet** if asked; set variables first.
- [ ] Settings → Environment Variables → **Preview** (staging) values; see `environment-setup.md` for every variable. Staging starts with `APP_ENV=staging`, `EMAIL_SENDING_ENABLED=false`, `AUTH_INVITES_ENABLED=false`.
- [ ] Check the same values locally before saving (prints names, never values):
  ```bash
  node --env-file=.env.staging.local scripts/check-env.mts     # must end "0 error(s)"
  ```
- [ ] Deploy a preview (push a branch, or "Redeploy").

### 1.5 First admin on staging
```bash
node --env-file=.env.staging.local scripts/invite-volunteer.mts carl@… "Carl Williams" admin
node --env-file=.env.staging.local scripts/invite-volunteer.mts <second admin> "<Name>" admin
```
- [ ] Both invitations arrive; both can sign in and land on **/manage**.

### 1.6 Staging smoke test (about 30 minutes, on a phone)
- [ ] Admin: Settings shows 2 venues, 9 duties, and the Email card says sending is **off**.
- [ ] Add 2 test volunteers in **Volunteers** (with invites switched on for staging only, or via the script). Grant one a *Site lead* authorisation.
- [ ] Create a Saturday fixture at Marke Wood from **T01**, choose site cover, publish.
- [ ] As a test volunteer on a phone: find it on the rota, sign up for a duty, see it in **My duties**, add it to the calendar.
- [ ] Organiser: the duty shows the person; **Coverage** shows the right gaps; the **printable rota** prints on one page per day.
- [ ] Email test (staging only): set `EMAIL_SENDING_ENABLED=true`, `EMAIL_STAGING_ALLOWLIST=<your own address>`, the provider key and from-address; redeploy; sign up for a duty as yourself → the confirmation arrives within a minute; another volunteer's sign-up sends **nothing** (it's not on the allow-list). The Email card shows the counts.
- [ ] `curl -i <staging>/api/cron/outbox` → **401**. With the header `Authorization: Bearer <CRON_SECRET>` → **200** and counts.

## 2. Production (only after Carl's explicit go-ahead)

### 2.1 Supabase production project (the club project already created)
- [ ] Region London; plan per `club-decisions.md` A6 (Pro recommended for daily backups and no pausing).
- [ ] Database → Backups shows daily backups (Pro), or the manual export routine in `backup-and-recovery.md` is in place (Free).
- [ ] Link and push exactly as in 1.2, with the **production** ref. Check the same counts (9 / 9 / 2 / 0 events).
- [ ] Auth settings exactly as in 1.3, with the production address. Custom SMTP **on**.

### 2.2 Vercel production
- [ ] Settings → Domains: add `rota.<club-domain>` and create the DNS record Vercel shows (club DNS owner).
- [ ] Environment Variables → **Production**: see `environment-setup.md`. Start in **pilot mode**: `APP_ENV=pilot`, `EMAIL_SENDING_ENABLED=false`, `AUTH_INVITES_ENABLED=false`.
- [ ] `node --env-file=.env.production.local scripts/check-env.mts` → 0 errors.
- [ ] Deploy `main` (Vercel deploys it automatically once the project is connected). The site loads at the club domain; `/login` shows the badge.
- [ ] Response headers include `x-frame-options: DENY` and `strict-transport-security` (browser dev tools → Network).

### 2.3 The reminder and retry schedule (pick ONE; `club-decisions.md` A6)
Confirmations are sent straight after each change. The schedule only queues day-before reminders and retries failed sends. Every 10 minutes is about right.

**Option 1: Vercel Pro.** Add `vercel.json` (one commit, with Carl's approval):
```json
{ "crons": [{ "path": "/api/cron/outbox", "schedule": "*/10 * * * *" }] }
```
Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when `CRON_SECRET` is set. (On Hobby, Vercel only allows once a day, and the deployment fails with a more frequent schedule.)

**Option 2: Vercel Hobby. Supabase schedules it.** Dashboard → Integrations: enable **Cron** and **pg_net** (Vault is on by default). Then in the SQL editor (replace the two values; the secret goes into Vault, not into the job text):
```sql
select vault.create_secret('<CRON_SECRET value>', 'rota_cron_secret');
select cron.schedule('rota-outbox', '*/10 * * * *', $$
  select net.http_get(
    url := 'https://rota.<club-domain>/api/cron/outbox',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'rota_cron_secret')),
    timeout_milliseconds := 30000);
$$);
```
- [ ] After 10 minutes: `select status_code, created from net._http_response order by created desc limit 3;` shows **200**. (A 401 means the secret doesn't match Vercel's `CRON_SECRET`.)

### 2.4 Admins and email switch-on
- [ ] Invite the two admins with the script (as 1.5, production env file). Confirm both can sign in.
- [ ] Set `AUTH_INVITES_ENABLED=true` (so admins invite people from the app) and redeploy.
- [ ] Email in pilot mode: `EMAIL_SENDING_ENABLED=true`, `EMAIL_STAGING_ALLOWLIST=<admins' addresses>`, provider key and from-address; redeploy. Sign up for a test duty as an admin → the email arrives; Settings → Email shows "pilot mode: only 2 approved addresses".
- [ ] Delete the test event (cancel it) so volunteers don't see it.

### 2.5 Start the pilot (`pilot-plan.md`)
- [ ] Add the pilot group in **Volunteers** (invites go out from the app).
- [ ] Add their addresses to `EMAIL_STAGING_ALLOWLIST` and redeploy, so only the pilot group gets rota emails.

### 2.6 General release (after the pilot review)
- [ ] `APP_ENV=production`, remove `EMAIL_STAGING_ALLOWLIST`, redeploy. The Email card says "Volunteers receive their emails".
- [ ] Invite everyone else.

---

## If something goes wrong
- **Bad deployment:** Vercel → Deployments → previous good deployment → **Instant Rollback**. This doesn't touch the database.
- **Emails going wrong:** set `EMAIL_SENDING_ENABLED=false` and redeploy (about 1 minute). Everything stays queued and nothing is lost; failures can be retried from Settings later.
- **Suspected key leak:** rotate it in Supabase (API keys → create new secret key, delete old) or Resend, update Vercel, redeploy. Change `CRON_SECRET` in both Vercel and Vault (Option 2).
- **Database problem:** migrations only move forward. Fix with a new migration, tested like the others. Restoring a backup (`backup-and-recovery.md`) is the last resort, because it loses everything since the backup.
