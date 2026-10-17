import "server-only";
import { timingSafeEqual, createHash } from "node:crypto";
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { emailConfig, runOutbox, type OutboxDb, type OutboxRow, type RunResult } from "./worker";
import { resendSender } from "./transport";

/**
 * Server-only wiring for the email worker: the secret-key client, used ONLY to call the four
 * outbox functions the database grants to the service role, plus the cron authentication check.
 */
function serviceDb(): OutboxDb {
  const sb = createClient(publicEnv().supabaseUrl, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn} failed: ${error.code ?? "unknown"}`);
    return data as T;
  };
  return {
    enqueueReminders: () => rpc<number>("outbox_enqueue_reminders", {}),
    claim: (limit) => rpc<OutboxRow[]>("outbox_claim", { p_limit: limit }),
    complete: (id, ok, error, providerId, retryable) =>
      rpc<string>("outbox_complete", { p_id: id, p_ok: ok, p_error: error, p_provider_message_id: providerId, p_retryable: retryable }),
    suppress: async (id, reason) => { await rpc("outbox_suppress", { p_id: id, p_reason: reason }); },
  };
}

export async function processOutbox(opts: { limit?: number; reminders?: boolean } = {}): Promise<RunResult> {
  const cfg = emailConfig();
  if (!cfg.enabled || cfg.problems.length) return runOutbox(serviceDbStub, async () => ({ ok: false, retryable: true, error: "disabled" }), cfg);
  const send = resendSender(process.env.EMAIL_PROVIDER_API_KEY!, process.env.EMAIL_API_BASE_URL || undefined);
  return runOutbox(serviceDb(), send, cfg, opts);
}

/** Never touched: runOutbox returns before using the database when sending is off or misconfigured. */
const serviceDbStub: OutboxDb = {
  enqueueReminders: async () => 0, claim: async () => [], complete: async () => "pending", suppress: async () => {},
};

/**
 * After a successful change, send its emails straight away (after the response, so the volunteer
 * never waits). The cron job is the safety net for anything this misses.
 */
export function kickOutbox(): void {
  if (process.env.EMAIL_SENDING_ENABLED !== "true") return;
  after(async () => {
    try {
      const r = await processOutbox({ limit: 10, reminders: false });
      if (r.claimed) log.info("outbox", "sent after change", { ...r, problems: undefined });
    } catch (e) {
      log.warn("outbox", "send after change failed", { error: e instanceof Error ? e.message : "unknown" });
    }
  });
}

/** Constant-time check of "Authorization: Bearer <CRON_SECRET>". Fails closed if no secret is set. */
export function cronAuthorised(header: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
