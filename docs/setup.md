# Setup guide (Phase 1)

How to connect the app to the club's Supabase project and invite the first administrator.
Do these steps **once** per Supabase project (later: once for staging, once for production).

> Never paste keys into chat or commit them. They go only in `.env.local` (local) or Vercel's environment settings (Phase 7).

## 1. Local environment
```bash
cp .env.example .env.local
```
Fill in from the Supabase project's API keys page:
- `NEXT_PUBLIC_SUPABASE_URL`: the Project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the publishable key (or legacy anon key)
- `SUPABASE_SECRET_KEY`: the secret key (or legacy service_role key). It is used only by the invite script.

## 2. Apply the database migration
Either use the Supabase CLI (recommended):
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
Or paste **each** file in `supabase/migrations/` into the dashboard SQL editor, **in filename order**, running each **once**.

## 3. Supabase Auth settings (dashboard)
1. **Turn off public sign-ups**: under Authentication sign-in settings, disable *Allow new users to sign up*. The app is invite-only, and the login form also enforces this with `shouldCreateUser: false`.
2. **URL configuration**: set the *Site URL* to the app address (`http://localhost:3000` for now). Add the *Redirect URL* `http://localhost:3000/auth/callback`. The production URL is added at Phase 7. Do not use wildcards in production.
3. **Email templates** must send a code and links that the server can verify:
   - **Magic link** template, body:
     ```html
     <h2>Your Cinque Ports FC rota sign-in code</h2>
     <p>Enter this code on the sign-in page: <strong>{{ .Token }}</strong></p>
     <p>Or <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">sign in with this link</a>.</p>
     <p>If you didn't ask to sign in, you can ignore this email.</p>
     ```
   - **Invite user** template, body:
     ```html
     <h2>You're invited to the Cinque Ports FC volunteer rota</h2>
     <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite">Accept the invitation</a></p>
     <p>Afterwards, sign in any time at {{ .SiteURL }}/login with this email address.</p>
     ```
4. **Email sending**: Supabase's built-in mailer is heavily rate-limited and is for testing only. Before the pilot, configure custom SMTP on a club-owned domain (Phase 7, decision Q7).

## 4. Invite the first administrator
```bash
node --env-file=.env.local scripts/invite-volunteer.mts you@example.org "Your Name" admin
```
The script creates the volunteer row and sends the Supabase invite. Repeat this for a **second admin** (recommended) and a test volunteer. Use the same command with `volunteer` or `coordinator` as the role.

## 5. Run it
```bash
npm install
npm run dev        # http://localhost:3000
```
Sign in with the invited email. Admins and coordinators land on **/manage**. Volunteers land on **/rota**.

## Running the checks
```bash
npm run lint
npm run typecheck
npm test           # unit + database tests
```
Database tests need a local PostgreSQL 16 on port 54329 (see `TEST_PG_ADMIN_URL`). They create and drop throwaway databases and **never** touch Supabase.
