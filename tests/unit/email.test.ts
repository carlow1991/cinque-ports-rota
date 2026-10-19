import { describe, expect, it, vi } from "vitest";
import { EMAIL_KINDS, escapeHtml, renderEmail } from "@/lib/email/templates";
import { resendSender, type SendInput } from "@/lib/email/transport";
import { emailConfig, runOutbox, type OutboxDb, type OutboxRow } from "@/lib/email/worker";
import { cronAuthorised } from "@/lib/email/server";
import { redact, log } from "@/lib/log";

vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

const SITE = "https://rota.example.org";
const EVENT = "11111111-2222-4333-8444-555555555555";
const payload = (over: Record<string, unknown> = {}) => ({
  assignment_id: "aaaaaaaa-2222-4333-8444-555555555555", status: "confirmed", event_id: EVENT,
  event_title: "First team v Hythe", venue: "Marke Wood", duty: "Turnstile",
  shift_starts_at: "2030-07-13T13:00:00Z", shift_ends_at: "2030-07-13T15:30:00Z",
  event_status_reason: null, removal_reason: null, demo: false, ...over,
});

describe("email templates", () => {
  // The kinds the database queues (kept in step with the migrations).
  const QUEUED = ["signup_confirmed", "signup_pending", "invitation_accepted", "approval_confirmed", "approval_declined",
    "duty_invitation", "withdrawal_confirmed", "assignment_removed", "cancellation_approved", "cancellation_declined",
    "event_cancelled", "event_postponed", "reconfirm_needed", "shift_cancelled", "reminder",
    "cancellation_requested", "venue_cover_at_risk",
    // Volunteer Hub kinds (queued by _hub_notify / outbox_enqueue_reminders)
    "availability_request", "assignment_request", "venue_cover_request", "assignment_reconfirm", "assignment_cancelled",
    "hub_event_cancelled", "hub_reminder", "assignment_confirmed", "assignment_declined", "assignment_withdrawn"];

  it("has a template for every kind the database queues, and nothing renders for unknown kinds", () => {
    expect([...EMAIL_KINDS].sort()).toEqual([...QUEUED].sort());
    expect(renderEmail("mystery", payload(), { siteUrl: SITE })).toBeNull();
  });

  it.each(QUEUED)("%s renders subject, text and html with the duty details and an app link", (kind) => {
    const m = renderEmail(kind, payload(), { recipientName: "Sam Jones", siteUrl: SITE })!;
    expect(m.subject.length).toBeGreaterThan(5);
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text).toContain("Hi Sam,");
    expect(m.text).toContain("First team v Hythe");
    expect(m.html).toContain("First team v Hythe");
    expect(m.text).toContain(SITE);
    expect(m.html).toMatch(/^<!doctype html>/);
    expect(m.text).not.toContain("undefined");
    expect(m.text).not.toContain("null");
  });

  it("shows UK time with BST in summer and GMT in winter", () => {
    const summer = renderEmail("reminder", payload(), { siteUrl: SITE })!;
    expect(summer.text).toContain("Saturday, 13 July 2030, 14:00–16:30 BST");
    const winter = renderEmail("reminder", payload({ shift_starts_at: "2030-12-14T15:00:00Z", shift_ends_at: "2030-12-14T17:00:00Z" }), { siteUrl: SITE })!;
    expect(winter.text).toContain("Saturday, 14 December 2030, 15:00–17:00 GMT");
    const late = renderEmail("signup_confirmed", payload({ shift_starts_at: "2030-07-13T21:00:00Z", shift_ends_at: "2030-07-13T23:30:00Z" }), { siteUrl: SITE })!;
    expect(late.text).toContain("22:00–00:30 (next day) BST");
  });

  it("escapes everything that came from the database, including in the subject line", () => {
    const m = renderEmail("assignment_removed", payload({ event_title: "<script>alert(1)</script>\r\nBcc: x@evil.test", removal_reason: "Too <b>many</b> & \"more\"" }), { recipientName: "<img src=x>", siteUrl: SITE })!;
    expect(m.html).not.toMatch(/<script>|<b>|<img/);
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("Too &lt;b&gt;many&lt;/b&gt; &amp; &quot;more&quot;");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(escapeHtml(`'"<>&`)).toBe("&#39;&quot;&lt;&gt;&amp;");
  });

  it("includes the reason only where it concerns the recipient's own duty", () => {
    expect(renderEmail("assignment_removed", payload({ removal_reason: "Duplicate booking" }), { siteUrl: SITE })!.text).toContain("Reason given: Duplicate booking");
    expect(renderEmail("event_cancelled", payload({ event_status_reason: "Waterlogged pitch" }), { siteUrl: SITE })!.text).toContain("Reason given: Waterlogged pitch");
    expect(renderEmail("signup_confirmed", payload({ event_status_reason: "x" }), { siteUrl: SITE })!.text).not.toContain("Reason");
  });

  it("organiser alerts name no volunteer and link to the manage pages", () => {
    const req = renderEmail("cancellation_requested", payload({ assignment_id: undefined }), { recipientName: "Org", siteUrl: SITE })!;
    expect(req.text).toContain("A volunteer has asked");
    expect(req.text).toContain(`${SITE}/manage/approvals`);
    const risk = renderEmail("venue_cover_at_risk", { event_id: EVENT, event_title: "U14 v Deal", starts_at: "2030-07-13T09:00:00Z", demo: false }, { siteUrl: SITE })!;
    expect(risk.text).toContain(`${SITE}/manage/events/${EVENT}`);
    expect(risk.text).toContain("10:00 BST");
  });

  it("a bad event id never turns into a strange link", () => {
    const m = renderEmail("reminder", payload({ event_id: "../../evil" }), { siteUrl: SITE })!;
    expect(m.text).toContain(`${SITE}/rota\n`);
  });
});

describe("Resend transport", () => {
  const msg: SendInput = { to: "a@example.org", from: "Rota <rota@example.org>", subject: "S", html: "<p>h</p>", text: "t", idempotencyKey: "signup_confirmed:abc:123" };

  it("posts to /emails with the bearer key and the outbox dedupe key as Idempotency-Key", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    const r = await resendSender("re_test_key", "https://mail.test/", f as unknown as typeof fetch)(msg);
    expect(r).toEqual({ ok: true, id: "msg_1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mail.test/emails");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer re_test_key");
    expect(h["Idempotency-Key"]).toBe("signup_confirmed:abc:123");
    expect(JSON.parse(String(init.body))).toEqual({ from: msg.from, to: ["a@example.org"], subject: "S", html: "<p>h</p>", text: "t" });
  });

  it.each([
    [429, "rate_limit_exceeded", true], [500, "internal_server_error", true], [503, "", true],
    [409, "concurrent_idempotent_requests", true], [409, "invalid_idempotent_request", false],
    [422, "validation_error", false], [403, "invalid_api_key", false],
  ])("status %i %s → retryable %s, with no provider message kept", async (status, name, retryable) => {
    const f = async () => new Response(JSON.stringify({ name, message: "The to address a@example.org is invalid" }), { status });
    const r = await resendSender("k", undefined, f as unknown as typeof fetch)(msg);
    expect(r).toMatchObject({ ok: false, retryable });
    expect(JSON.stringify(r)).not.toContain("@");
  });

  it("network errors and timeouts are retryable", async () => {
    const f = async () => { throw new DOMException("timed out", "TimeoutError"); };
    expect(await resendSender("k", undefined, f as unknown as typeof fetch)(msg)).toEqual({ ok: false, retryable: true, error: "network: TimeoutError" });
  });
});

describe("worker safety gates", () => {
  const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
    id: crypto.randomUUID(), kind: "signup_confirmed", dedupe_key: `k:${Math.random()}`, payload: payload(), attempt_count: 1,
    recipient_email: "Allowed@Example.org", recipient_name: "Sam", ...over });
  function fakeDb(rows: OutboxRow[]) {
    const calls = { suppress: [] as [string, string][], complete: [] as unknown[][], enqueue: 0, claim: 0 };
    const db: OutboxDb = {
      enqueueReminders: async () => { calls.enqueue++; return 2; },
      claim: async () => { calls.claim++; return rows; },
      complete: async (...a) => { calls.complete.push(a); return a[1] ? "sent" : a[4] ? "pending" : "failed"; },
      suppress: async (id, why) => { calls.suppress.push([id, why]); },
    };
    return { db, calls };
  }
  const env = (over: Record<string, string> = {}) => emailConfig({
    EMAIL_SENDING_ENABLED: "true", EMAIL_PROVIDER_API_KEY: "re_x", EMAIL_FROM_ADDRESS: "rota@example.org",
    SUPABASE_SECRET_KEY: "sb_secret_x", NEXT_PUBLIC_SITE_URL: SITE, APP_ENV: "staging", EMAIL_STAGING_ALLOWLIST: " allowed@example.org , other@example.org", ...over });
  const NOW = () => new Date("2030-07-01T12:00:00Z");

  it("does nothing at all (no database call, no send) unless sending is switched on", async () => {
    const { db, calls } = fakeDb([row()]);
    const send = vi.fn();
    const r = await runOutbox(db, send, emailConfig({ EMAIL_SENDING_ENABLED: "false", EMAIL_PROVIDER_API_KEY: "x" }));
    expect(r.enabled).toBe(false);
    expect(calls).toMatchObject({ claim: 0, enqueue: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to run when switched on but not configured", async () => {
    const { db, calls } = fakeDb([row()]);
    const r = await runOutbox(db, vi.fn(), emailConfig({ EMAIL_SENDING_ENABLED: "true" }));
    expect(r.problems).toEqual(expect.arrayContaining(["EMAIL_PROVIDER_API_KEY is not set", "EMAIL_FROM_ADDRESS is not set"]));
    expect(calls.claim).toBe(0);
  });

  it("outside production, only allow-listed addresses are sent to; the rest are suppressed", async () => {
    const ok = row(), blocked = row({ recipient_email: "real.person@example.org" });
    const { db, calls } = fakeDb([ok, blocked]);
    const send = vi.fn(async () => ({ ok: true as const, id: "m1" }));
    const r = await runOutbox(db, send, env(), { now: NOW });
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [SendInput])[0]).toMatchObject({ to: "allowed@example.org", idempotencyKey: ok.dedupe_key });
    expect(calls.suppress).toEqual([[blocked.id, "not_allowlisted"]]);
    expect(r).toMatchObject({ reminders: 2, claimed: 2, sent: 1, suppressed: 1 });
  });

  it("in production everyone gets their email; demo, stale and unknown messages never do", async () => {
    const good = row({ recipient_email: "real.person@example.org" });
    const demo = row({ payload: payload({ demo: true }) });
    const stale = row({ payload: payload({ shift_starts_at: "2030-06-30T10:00:00Z" }) });
    const odd = row({ kind: "mystery" });
    const { db, calls } = fakeDb([good, demo, stale, odd]);
    const send = vi.fn(async () => ({ ok: true as const, id: "m1" }));
    const r = await runOutbox(db, send, env({ APP_ENV: "production", EMAIL_STAGING_ALLOWLIST: "" }), { now: NOW });
    expect(send).toHaveBeenCalledTimes(1);
    expect(calls.suppress.map(([, w]) => w).sort()).toEqual(["demo", "stale_duty_started", "unknown_kind"]);
    expect(r.sent).toBe(1);
  });

  it("passes failures back for retry or failure, and survives a sender that throws", async () => {
    const a = row(), b = row(), c = row();
    const { db, calls } = fakeDb([a, b, c]);
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: false, retryable: true, error: "http 503" })
      .mockResolvedValueOnce({ ok: false, retryable: false, error: "http 422 validation_error" })
      .mockRejectedValueOnce(new Error("boom"));
    const r = await runOutbox(db, send, env(), { now: NOW });
    expect(calls.complete).toEqual([
      [a.id, false, "http 503", null, true], [b.id, false, "http 422 validation_error", null, false], [c.id, false, "sender threw", null, true]]);
    expect(r).toMatchObject({ retrying: 2, failed: 1, sent: 0 });
  });

  it("the after-change run skips queuing reminders", async () => {
    const { db, calls } = fakeDb([]);
    await runOutbox(db, vi.fn(), env(), { reminders: false });
    expect(calls.enqueue).toBe(0);
  });
});

describe("cron authentication", () => {
  const S = "a-long-random-cron-secret-value";
  it("accepts only the exact bearer secret", () => {
    expect(cronAuthorised(`Bearer ${S}`, S)).toBe(true);
    expect(cronAuthorised(`Bearer ${S}x`, S)).toBe(false);
    expect(cronAuthorised(S, S)).toBe(false);
    expect(cronAuthorised(null, S)).toBe(false);
  });
  it("fails closed when no secret (or a short one) is configured", () => {
    expect(cronAuthorised("Bearer ", "")).toBe(false);
    expect(cronAuthorised("Bearer undefined", undefined)).toBe(false);
    expect(cronAuthorised("Bearer short", "short")).toBe(false);
  });
});

describe("redacting logger", () => {
  it("scrubs addresses, tokens, keys and phone numbers from values", () => {
    expect(redact("send to sam.jones+x@example.org failed")).toBe("send to [email] failed");
    expect(redact("Authorization: Bearer abc.def-123")).toBe("Authorization: Bearer [redacted]");
    expect(redact("key sb_secret_AbCdEf123 and re_123456789")).toBe("key [key] and [key]");
    expect(redact("call 07700 900123")).toBe("call [number]");
  });
  it("drops personal fields entirely and keeps counts", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    log.info("outbox", "done for a@b.co", { sent: 3, email: "a@b.co", recipient_name: "Sam", nested: { phone: "0", code: "x" }, list: ["a@b.co"] });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toEqual({ level: "info", scope: "outbox", message: "done for [email]", sent: 3, nested: { code: "x" }, list: "[1 items]" });
    spy.mockRestore();
  });
});

describe("Volunteer Hub email kinds", () => {
  it("render recipient-safe content with the right links", async () => {
    const { renderEmail } = await import("@/lib/email/templates");
    const base = { event_id: "2f1c0c34-9ef5-4c63-8fd5-9f4a0e1d2b3c", event_title: "Ladies v Test", venue: "Marke Wood", duty: "Matchday support",
      shift_starts_at: "2026-11-07T13:00:00Z", shift_ends_at: "2026-11-07T16:00:00Z" };
    const a = renderEmail("availability_request", base, { recipientName: "Kelly Demo", siteUrl: "https://hub.example" })!;
    expect(a.subject).toBe("Can you help? Ladies v Test");
    expect(a.text).toContain("https://hub.example/calendar/2f1c0c34-9ef5-4c63-8fd5-9f4a0e1d2b3c");
    expect(a.text).toContain("isn't a booking");
    const inv = renderEmail("assignment_request", base, { recipientName: "Bob", siteUrl: "https://hub.example" })!;
    expect(inv.text).toContain("Helping with: Matchday support");
    expect(inv.text).toContain("https://hub.example/home");
    const org = renderEmail("assignment_declined", { ...base, person_name: "Steve <script>" }, { recipientName: "Alex", siteUrl: "https://hub.example" })!;
    expect(org.subject).toBe("Steve <script> can't help: Matchday support, Ladies v Test");
    expect(org.html).not.toContain("<script>");
    for (const k of ["venue_cover_request", "assignment_reconfirm", "assignment_cancelled", "hub_event_cancelled", "hub_reminder", "assignment_confirmed", "assignment_withdrawn"]) {
      expect(renderEmail(k, base, { siteUrl: "https://hub.example" })).not.toBeNull();
    }
  });
});
