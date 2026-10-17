# Backup and recovery

## What needs protecting
| Thing | Where it lives | How it's protected |
|---|---|---|
| The rota data (people, events, duties, history) | Supabase production database | Supabase backups (plan-dependent) **plus** a monthly export by the club |
| The app's code and database structure | GitHub `cinque-ports-rota` | Git history. Every migration is in `supabase/migrations/`, so the structure can be rebuilt exactly |
| Settings and keys | Vercel + Supabase dashboards | Recorded (names, and where the values are kept) in the club password manager |
| Sign-in accounts | Supabase Auth (same project) | Included in Supabase backups. If lost, people are simply re-invited; their rota record is matched by email |

## Supabase backups by plan (checked against Supabase docs, Oct 2026)
- **Free:** **no** automatic backups. Supabase recommends regular manual exports. Free projects are also **paused after 7 days of low activity** (data is kept; an owner resumes it in the dashboard), which would take the rota offline in a quiet week.
- **Pro:** daily backups kept **7 days**, restorable from Dashboard → Database → Backups. No pausing.
- **Point-in-time recovery** (restore to any moment, at most about 2 minutes lost) is a paid add-on of roughly $100 a month. It's **not needed** for a club rota.

**Recommendation:** Pro for the production project during the pilot and season (`club-decisions.md` A6), plus the monthly export below. Staging can stay Free.

## Monthly export (whatever the plan) by an admin, about 10 minutes
This follows Supabase's official guide ("Backup and restore using the CLI"). The export includes sign-in accounts, so a restore needs no re-invites.
Needs, on a trusted computer: **Docker Desktop running** (the CLI uses it to dump), Node, and the **Session pooler** connection string (Dashboard → Connect).
```bash
export DB="<session pooler connection string, with the database password>"
npx supabase@2 db dump --db-url "$DB" -f roles.sql --role-only
npx supabase@2 db dump --db-url "$DB" -f schema.sql
npx supabase@2 db dump --db-url "$DB" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
```
- Put the three files in one dated folder (`rota-backup-YYYY-MM`) in the club's **access-controlled** storage (they contain names, emails and phone numbers). **Not** GitHub, email or a shared folder.
- Keep 12 months, delete older exports (privacy guide §5).
- Twice a year, test a restore into a **new, temporary** project (below) so the club knows it works.

## Recovery scenarios
| What happened | What to do | Data lost |
|---|---|---|
| A bad app release | Vercel → Deployments → previous good one → **Instant Rollback** | None |
| Someone changed the wrong thing in the app (removed people, cancelled an event) | Most changes are visible in the audit history (admins). Put it right in the app: re-invite, re-allocate, reschedule. Don't restore a backup for this | None |
| Emails misbehaving | Set `EMAIL_SENDING_ENABLED=false`, redeploy, investigate. Retry from Settings later | None |
| Database damaged or data deleted at scale | Dashboard → Database → Backups → restore the last good daily backup. **The site is offline during the restore**, and everything after that backup is lost, so tell organisers to re-check recent duties | Up to 24 h (Pro) |
| Supabase project lost, or Free project with no backup | Create a new project, then restore the latest monthly export into it (below), then update Vercel's three Supabase settings and the Auth settings (`deployment-checklist.md` 2.1), and redeploy | Since the last export |
| A key leaked | Rotate it (`deployment-checklist.md`, "If something goes wrong") | None |

## Restoring an export into a new project (also the twice-yearly test)
1. Create a **new** Supabase project (London). Don't run `db push` on it: the export brings the structure.
2. Enable the **Cron** and **pg_net** integrations only if the schedule ran in Supabase (`deployment-checklist.md` 2.3, Option 2).
3. With PostgreSQL's `psql` installed and the new project's **Session pooler** string:
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "<new project's connection string>"
   ```
   If it stops with a `supabase_admin` or `cli_login_postgres` permission error, follow the "Common errors" section of Supabase's guide, then run it again into a fresh project.
4. Sign in to the restored copy as an admin and check that recent events and people are there.
5. **For a test:** delete the temporary project afterwards, because it holds real personal data.

Reference: Supabase docs, *Backup and Restore using the CLI* (`supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore`).
