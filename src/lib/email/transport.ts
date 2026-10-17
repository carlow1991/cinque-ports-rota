/**
 * Email provider transport (Resend HTTP API). Server-only.
 * The outbox dedupe key is sent as the Idempotency-Key, so if a send times out and is retried,
 * the provider returns the original result instead of sending a second copy (kept 24 hours).
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 */
export type SendInput = { to: string; from: string; subject: string; html: string; text: string; idempotencyKey: string };
export type SendResult = { ok: true; id: string | null } | { ok: false; retryable: boolean; error: string };
export type Sender = (m: SendInput) => Promise<SendResult>;

export function resendSender(apiKey: string, baseUrl = "https://api.resend.com", fetchImpl: typeof fetch = fetch): Sender {
  const url = `${baseUrl.replace(/\/+$/, "")}/emails`;
  return async (m) => {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": m.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { ok: false, retryable: true, error: `network: ${e instanceof Error ? e.name : "error"}` };
    }
    let body: { id?: unknown; name?: unknown } = {};
    try { body = await res.json(); } catch { /* empty or non-JSON body */ }
    if (res.ok) return { ok: true, id: typeof body.id === "string" ? body.id : null };
    // Only the status and the provider's error name are kept: never the message, which can echo addresses.
    const name = typeof body.name === "string" ? body.name.replace(/[^a-z_]/gi, "").slice(0, 60) : "";
    const retryable = res.status === 429 || res.status >= 500 || name === "concurrent_idempotent_requests";
    return { ok: false, retryable, error: `http ${res.status}${name ? ` ${name}` : ""}` };
  };
}
