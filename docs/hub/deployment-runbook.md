# Volunteer Hub — deployment runbook

**Nothing in this runbook has been done.** Each step that touches the live Supabase project, Vercel or
email needs Carl's go-ahead first. Read `stage-0-audit.md` §7 for the decisions involved.

The live project today: Supabase "Cinque Ports Rota" (eu-west-2) with all 20 rota migrations, 1 admin,
2 venues, 1 published fixture with 4 shifts, no assignments (checked read-only, 18–19 Oct 2026). The
preflight (`docs/sql/hub-preflight.sql`) returned **0 problems on every check** on 19 Oct 2026.

## 0. Before you start (decisions)
- [ ] Staging: create a free second Supabase project (recommended), or accept the local rehearsal as the test.
- [ ] Freemens Way becomes inactive (Stage 2 migration does this; its history stays).
- [ ] Privacy notice text approved (`src/lib/privacy.ts`: set `PRIVACY_NOTICE_APPROVED = true` and bump `PRIVACY_NOTICE_VERSION` when the wording changes).
- [ ] Club contact email for the public pages (Settings → Club and Hub, once deployed).

## 1. Take a backup and a snapshot (live, read-only)
1. Supabase dashboard → Database → Backups: note the latest daily backup time (Pro plan), or run `supabase db dump` from a trusted machine into the club's storage.
2. Export the current data: Table editor → `volunteers`, `events`, `event_shifts`, `audit_log` → Export CSV.
3. Run `docs/sql/hub-preflight.sql` in the SQL editor. **Every row must show 0.** Stop if not.

## 2. Fix the migration history (one-off)
Only 8 of the 20 rota migrations are recorded in `supabase_migrations.schema_migrations` (the rest were
pasted into the SQL editor). Run `docs/sql/align-migration-history.sql` once, then confirm
`supabase migration list` shows local and remote in step. Without this, `supabase db push` would try to
re-run 12 migrations.

## 3. Staging first (recommended)
1. New Supabase project "Cinque Ports Rota (staging)", same region.
2. `supabase link --project-ref <staging>` then `supabase db push` (all 28 migrations).
3. Vercel: a Preview environment pointing at staging (`APP_ENV=staging`, email allow-list = your own addresses).
4. Bootstrap yourself: `node --env-file=.env.staging scripts/invite-volunteer.mts you@club "Your Name" admin`.
5. Run the demo script by hand (`docs/hub/05_ACCEPTANCE_TESTS.md`, "Demo script owner can run in staging").

## 4. Apply to production
1. Merge `hub/volunteer-hub` into `main` (after review).
2. `supabase link --project-ref cxesxjclhfwvqgchkqlb` → `supabase db push`. This applies, in order:
   `20261019000100_hub_people` … `20261019000800_hub_hardening`. Each is a single transaction.
3. Check: `select count(*) from people` equals `select count(*) from volunteers`; your login works and lands on `/manage`.
4. Deploy the app (Vercel Production). Environment changes:
   - `LEGACY_ROTA_UI=false`
   - `CLUB_CONTACT_EMAIL=<club address>` (fallback; Settings value wins)
   - `SUPABASE_SECRET_KEY` must be set (public form + opportunities). Keep it server-only.
   - Run `npm run check-env` against the production values (prints names, never values).
5. Settings → Club and Hub: contact email, applications on/off, retention period (when agreed).
6. Settings → Teams: add the club's teams; People → link managers to their teams (Scott, Danny, Matty — verify which teams first).
7. Club roles → "Add the usual roles", then add the real holders and choose which posts recruit.

## 5. Email (separate go-ahead)
Unchanged from the rota: verified sending domain in Resend (decision A3), then `EMAIL_SENDING_ENABLED=true`
and `APP_ENV=pilot` with an allow-list for the pilot group, then Settings → Email → "Start: new emails only".
Hub messages queue only after deliberate actions (requests, invitations, answers, reconfirmations,
cancellations, day-before reminders) — never for adding people, events or applications.

## 6. Smoke test (production, 10 minutes)
Sign in → Manage overview loads → create a draft test event (outside location "Test — delete me") →
publish → it's on the calendar → cancel it with a reason → `/volunteer` loads (no names) →
`/volunteer/apply` loads (don't submit) → Settings → download People CSV.

## 7. Rollback
- **App only:** redeploy `main` @ `98c0f6d` (the last pre-Hub commit). The database stays Hub-ready; the old app ignores the new tables.
- **Database:** run the rollback scripts in reverse order, each in one transaction:
  `docs/sql/rollback-20261019000800.sql` … `rollback-20261019000100.sql`.
  Export Hub data first (Settings → downloads): Stages 3–6 rollbacks drop commitments, club roles and applications.
  Stage 2's rollback refuses to run while any event has no venue or no finish time (it won't invent data) — fix or export those first.
  The full forward + reverse sequence is rehearsed by `tests/db/hub-rehearsal.db.test.ts` on production-shaped data, with legacy checksums compared.

## 8. After launch
- Weekly: Manage → Needs attention; Applications follow-ups.
- Monthly: Settings → download People, Applications, Commitments (store securely, delete old copies).
- Quarterly: access review (People → Portal filter; check administrators and coordinators).
