# Environment settings

Where each setting goes, and what it should be in each place. **Names only here, never values.**
Check any set of values with `node --env-file=<file> scripts/check-env.mts`. It prints names and problems, never values.

| Where | What it's for |
|---|---|
| `.env.local` (your computer) | Local development, `npm run dev` |
| Vercel → **Preview** | Staging: test deployments on the staging Supabase project |
| Vercel → **Production** | The real site: `rota.<club-domain>` on the club Supabase project |

## Settings

| Setting | Secret? | Staging (Preview) | Pilot (Production, first weeks) | Production (general release) |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no (in browser) | staging Project URL | club Project URL | club Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no (in browser) | staging publishable key | club publishable key | same |
| `NEXT_PUBLIC_SITE_URL` | no | staging address | `https://rota.<club-domain>` | same |
| `SUPABASE_SECRET_KEY` | **yes** | staging secret key | club secret key | same |
| `APP_ENV` | no | `staging` | `pilot` | `production` |
| `AUTH_INVITES_ENABLED` | no | `false` (or `true` briefly while testing) | `true` once the admins are in | `true` |
| `EMAIL_SENDING_ENABLED` | no | `false`, `true` only for the email test | `true` after the admin test send | `true` |
| `EMAIL_PROVIDER_API_KEY` | **yes** | Resend key (can be a separate, restricted key) | Resend key | same |
| `EMAIL_FROM_ADDRESS` | no | `Cinque Ports FC Rota <rota@<club-domain>>` | same | same |
| `EMAIL_STAGING_ALLOWLIST` | no (but personal) | your own address | admins + pilot group, comma-separated | **remove** |
| `CRON_SECRET` | **yes** | 32+ random characters | a **different** 32+ random characters | same as pilot |

**Never set in Vercel:** `EMAIL_API_BASE_URL` and `TEST_PG_ADMIN_URL` (automated tests only).

### Notes
- **`NEXT_PUBLIC_…` values are sent to every visitor's browser.** Only the URL and the *publishable* key belong there. `check-env` refuses a secret in any `NEXT_PUBLIC_` setting.
- **The secret key** can only call the email worker and the first-admin bootstrap. The database refuses it everything else (least privilege, D-701). It is still powerful (Auth invites), so keep it in Vercel and the password manager only.
- **Generating a `CRON_SECRET`:** `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Paste it into Vercel (and Supabase Vault if Supabase runs the schedule).
- **Changing a setting** takes effect on the **next deployment**: Vercel → Deployments → ⋯ → Redeploy.
- **`APP_ENV` only controls who receives email.** `production` emails everyone. `development`, `staging` and `pilot` email only `EMAIL_STAGING_ALLOWLIST`, and everything else is suppressed for good (it won't go out later).
- Supabase Auth's own emails (sign-in codes, invitations) use the SMTP settings in the Supabase dashboard, not these settings.
