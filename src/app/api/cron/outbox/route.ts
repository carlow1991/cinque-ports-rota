import { cronAuthorised, processOutbox } from "@/lib/email/server";
import { log } from "@/lib/log";

/**
 * Email worker endpoint, called by the scheduler (Vercel Cron sends
 * "Authorization: Bearer $CRON_SECRET"). Queues day-before reminders, then sends due messages.
 * Responds with counts only: never addresses, names or message content.
 */
export async function GET(request: Request) {
  if (!cronAuthorised(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorised" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const r = await processOutbox();
    if (r.problems?.length) log.error("outbox", "email sending is on but not configured", { problems: r.problems.join("; ") });
    else if (r.claimed || r.reminders) log.info("outbox", "run complete", { ...r });
    return Response.json(r, { status: r.problems?.length ? 500 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log.error("outbox", "run failed", { error: e instanceof Error ? e.message : "unknown" });
    return Response.json({ error: "run_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
