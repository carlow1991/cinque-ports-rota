/**
 * Pre-deployment checks for one environment's settings (Vercel Production, Vercel Preview, or
 * .env.local). Pure function: it returns findings that name the setting and the problem, and
 * NEVER includes a value, so the output is safe to share.
 * Used by scripts/check-env.mts and tested in tests/unit/env-rules.test.ts.
 */
export type Finding = { level: "error" | "warn"; name: string; problem: string };
type Env = Record<string, string | undefined>;

const ENVS = ["development", "staging", "pilot", "production"];
const has = (e: Env, k: string) => Boolean(e[k] && e[k]!.trim());
const isTrue = (e: Env, k: string) => e[k] === "true";

function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()).role ?? null;
  } catch {
    return null;
  }
}
const looksSecret = (v: string) => v.startsWith("sb_secret_") || v.startsWith("re_") || jwtRole(v) === "service_role";

function url(v: string | undefined): URL | null {
  try { return v ? new URL(v) : null; } catch { return null; }
}

export function checkEnv(e: Env): Finding[] {
  const out: Finding[] = [];
  const err = (name: string, problem: string) => out.push({ level: "error", name, problem });
  const warn = (name: string, problem: string) => out.push({ level: "warn", name, problem });

  const appEnv = e.APP_ENV ?? "";
  if (!ENVS.includes(appEnv)) err("APP_ENV", "must be development, staging, pilot or production");
  const live = appEnv === "staging" || appEnv === "pilot" || appEnv === "production";
  const prod = appEnv === "production";

  // ---- Browser-visible values: must never carry a secret --------------------------------------
  for (const [k, v] of Object.entries(e)) {
    if (!k.startsWith("NEXT_PUBLIC_") || !v) continue;
    if (looksSecret(v)) err(k, "contains a SECRET key. NEXT_PUBLIC_ values are sent to every browser. Remove it now and rotate that key");
    if (/SECRET|PASSWORD|PRIVATE|SERVICE_ROLE/i.test(k)) err(k, "a secret must never use the NEXT_PUBLIC_ prefix");
  }

  const sb = url(e.NEXT_PUBLIC_SUPABASE_URL);
  if (!sb) err("NEXT_PUBLIC_SUPABASE_URL", "missing or not a valid URL");
  else {
    if (live && sb.protocol !== "https:") err("NEXT_PUBLIC_SUPABASE_URL", "must use https");
    if (live && !sb.hostname.endsWith(".supabase.co")) warn("NEXT_PUBLIC_SUPABASE_URL", "is not a *.supabase.co address; check it is the club's project");
  }
  const pub = e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!pub) err("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "missing");
  else if (!pub.startsWith("sb_publishable_") && jwtRole(pub) !== "anon") warn("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "doesn't look like a publishable (or legacy anon) key");

  const site = url(e.NEXT_PUBLIC_SITE_URL);
  if (!site) err("NEXT_PUBLIC_SITE_URL", "missing or not a valid URL");
  else {
    if (live && site.protocol !== "https:") err("NEXT_PUBLIC_SITE_URL", "must use https (sign-in links and cookies depend on it)");
    if (site.pathname !== "/" || site.search) err("NEXT_PUBLIC_SITE_URL", "must be just the address, with no path, e.g. https://rota.example.org");
    if (prod && /vercel\.app$/.test(site.hostname)) warn("NEXT_PUBLIC_SITE_URL", "is a vercel.app address; use the club's own domain for production");
    if (live && /localhost|127\.0\.0\.1/.test(site.hostname)) err("NEXT_PUBLIC_SITE_URL", "points at this computer, not the live site");
  }

  // ---- Server-only secrets -------------------------------------------------------------------
  const secret = e.SUPABASE_SECRET_KEY ?? "";
  const needsSecret = isTrue(e, "AUTH_INVITES_ENABLED") || isTrue(e, "EMAIL_SENDING_ENABLED");
  if (needsSecret && !secret) err("SUPABASE_SECRET_KEY", "required because invites or email sending is switched on");
  if (secret) {
    if (secret === pub) err("SUPABASE_SECRET_KEY", "is the same as the publishable key");
    else if (secret.startsWith("sb_publishable_") || jwtRole(secret) === "anon") err("SUPABASE_SECRET_KEY", "is a publishable/anon key, not the secret key");
  }

  for (const k of ["AUTH_INVITES_ENABLED", "EMAIL_SENDING_ENABLED"]) {
    if (has(e, k) && e[k] !== "true" && e[k] !== "false") err(k, 'must be exactly "true" or "false"');
  }

  const cron = e.CRON_SECRET ?? "";
  if (cron && cron.length < 32) err("CRON_SECRET", "too short; use at least 32 random characters");
  if (live && !cron) warn("CRON_SECRET", "not set, so the reminder/retry schedule can't run (the endpoint refuses every call)");

  // ---- Email ---------------------------------------------------------------------------------
  if (isTrue(e, "EMAIL_SENDING_ENABLED")) {
    if (!has(e, "EMAIL_PROVIDER_API_KEY")) err("EMAIL_PROVIDER_API_KEY", "required when email sending is on");
    const from = e.EMAIL_FROM_ADDRESS ?? "";
    if (!from) err("EMAIL_FROM_ADDRESS", "required when email sending is on");
    else if (!/^([^<>]+<)?[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>?$/.test(from.trim())) err("EMAIL_FROM_ADDRESS", 'should look like Cinque Ports FC Rota <rota@your-domain>');
    if (!cron) err("CRON_SECRET", "required when email sending is on (reminders and retries)");
    if (!prod && !has(e, "EMAIL_STAGING_ALLOWLIST")) warn("EMAIL_STAGING_ALLOWLIST", `is empty, so with APP_ENV=${appEnv} every email will be held back`);
  }
  if (prod && has(e, "EMAIL_STAGING_ALLOWLIST")) warn("EMAIL_STAGING_ALLOWLIST", "is ignored in production; everyone receives their email");
  if (live && has(e, "EMAIL_API_BASE_URL")) err("EMAIL_API_BASE_URL", "is for automated tests only; remove it");
  if (!prod && isTrue(e, "AUTH_INVITES_ENABLED")) warn("AUTH_INVITES_ENABLED", "is on outside production: invitations are real emails to real people");

  if (live && has(e, "TEST_PG_ADMIN_URL")) warn("TEST_PG_ADMIN_URL", "is for local tests only; don't set it in Vercel");
  return out;
}
