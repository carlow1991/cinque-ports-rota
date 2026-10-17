/**
 * The outbox sender. Runs on the server only (cron route, or straight after a change).
 *
 * Safety gates, in order:
 *  1. Nothing happens unless EMAIL_SENDING_ENABLED=true AND the provider key, from address and
 *     Supabase secret key are all set.
 *  2. Demo events are suppressed in the database when queued, so they never reach this code.
 *  3. Outside APP_ENV=production, only addresses on EMAIL_STAGING_ALLOWLIST receive mail;
 *     everything else is suppressed (not left pending, so it can't go out later by surprise).
 *  4. The database re-checks each message at claim time (suspended recipient, cancelled duty).
 *  5. Messages about a duty that has already started are suppressed as stale.
 * Each message is claimed by exactly one worker and sent with its dedupe key as the provider
 * idempotency key, so a retry after a timeout cannot produce a second email.
 */
import { renderEmail } from "./templates";
import type { Sender } from "./transport";

export type OutboxRow = {
  id: string; kind: string; dedupe_key: string; payload: Record<string, unknown>;
  attempt_count: number; recipient_email: string; recipient_name: string | null;
};

/** The four database calls the worker needs (all granted to the service role only). */
export type OutboxDb = {
  enqueueReminders(): Promise<number>;
  claim(limit: number): Promise<OutboxRow[]>;
  complete(id: string, ok: boolean, error: string | null, providerId: string | null, retryable: boolean): Promise<string>;
  suppress(id: string, reason: string): Promise<void>;
};

export type EmailConfig = {
  enabled: boolean; production: boolean; from: string; siteUrl: string;
  allowlist: Set<string>; problems: string[];
};

export type RunResult = {
  enabled: boolean; problems?: string[];
  reminders: number; claimed: number; sent: number; retrying: number; failed: number; suppressed: number;
};

export function emailConfig(env: Record<string, string | undefined> = process.env): EmailConfig {
  const problems: string[] = [];
  const enabled = env.EMAIL_SENDING_ENABLED === "true";
  if (enabled) {
    if (!env.EMAIL_PROVIDER_API_KEY) problems.push("EMAIL_PROVIDER_API_KEY is not set");
    if (!env.EMAIL_FROM_ADDRESS) problems.push("EMAIL_FROM_ADDRESS is not set");
    if (!env.SUPABASE_SECRET_KEY) problems.push("SUPABASE_SECRET_KEY is not set");
    if (!env.NEXT_PUBLIC_SITE_URL) problems.push("NEXT_PUBLIC_SITE_URL is not set");
  }
  return {
    enabled,
    production: env.APP_ENV === "production",
    from: env.EMAIL_FROM_ADDRESS ?? "",
    siteUrl: (env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    allowlist: new Set((env.EMAIL_STAGING_ALLOWLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)),
    problems,
  };
}

function dutyHasStarted(p: Record<string, unknown>, now: Date): boolean {
  const t = typeof p.shift_starts_at === "string" ? Date.parse(p.shift_starts_at)
    : typeof p.starts_at === "string" ? Date.parse(p.starts_at) : NaN;
  return Number.isFinite(t) && t <= now.getTime();
}

export async function runOutbox(db: OutboxDb, send: Sender, cfg: EmailConfig, opts: { limit?: number; reminders?: boolean; now?: () => Date } = {}): Promise<RunResult> {
  const r: RunResult = { enabled: cfg.enabled, reminders: 0, claimed: 0, sent: 0, retrying: 0, failed: 0, suppressed: 0 };
  if (!cfg.enabled) return r;
  if (cfg.problems.length) return { ...r, problems: cfg.problems };
  const now = opts.now ?? (() => new Date());

  if (opts.reminders !== false) r.reminders = await db.enqueueReminders();
  const batch = await db.claim(opts.limit ?? 25);
  r.claimed = batch.length;

  for (const m of batch) {
    const to = m.recipient_email.trim().toLowerCase();
    if (m.payload.demo === true) { await db.suppress(m.id, "demo"); r.suppressed++; continue; }
    if (!cfg.production && !cfg.allowlist.has(to)) { await db.suppress(m.id, "not_allowlisted"); r.suppressed++; continue; }
    if (m.kind !== "venue_cover_at_risk" && dutyHasStarted(m.payload, now())) { await db.suppress(m.id, "stale_duty_started"); r.suppressed++; continue; }
    const email = renderEmail(m.kind, m.payload, { recipientName: m.recipient_name, siteUrl: cfg.siteUrl });
    if (!email) { await db.suppress(m.id, "unknown_kind"); r.suppressed++; continue; }

    let res;
    try {
      res = await send({ to, from: cfg.from, ...email, idempotencyKey: m.dedupe_key });
    } catch {
      res = { ok: false as const, retryable: true, error: "sender threw" };
    }
    const status = res.ok
      ? await db.complete(m.id, true, null, res.id, true)
      : await db.complete(m.id, false, res.error, null, res.retryable);
    if (status === "sent") r.sent++;
    else if (status === "pending") r.retrying++;
    else if (status === "failed") r.failed++;
  }
  return r;
}
