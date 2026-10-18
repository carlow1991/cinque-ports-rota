import { describe, expect, it } from "vitest";
import { capitalise, messagingState, notifyFuture, notifyOutcome } from "@/lib/email/state";

const full = {
  EMAIL_SENDING_ENABLED: "true", EMAIL_PROVIDER_API_KEY: "k", EMAIL_FROM_ADDRESS: "rota@example.test",
  SUPABASE_SECRET_KEY: "s", NEXT_PUBLIC_SITE_URL: "https://example.test",
};

describe("messagingState", () => {
  it("is off unless the switch is exactly 'true'", () => {
    expect(messagingState({})).toBe("off");
    expect(messagingState({ ...full, EMAIL_SENDING_ENABLED: "yes" })).toBe("off");
  });
  it("is misconfigured when switched on with a setting missing", () => {
    expect(messagingState({ ...full, EMAIL_PROVIDER_API_KEY: undefined })).toBe("misconfigured");
  });
  it("is limited outside production (pilot, staging, development) and on only in production", () => {
    for (const APP_ENV of ["pilot", "staging", "development", undefined]) expect(messagingState({ ...full, APP_ENV })).toBe("limited");
    expect(messagingState({ ...full, APP_ENV: "production" })).toBe("on");
  });
});

describe("wording never claims delivery that did not happen", () => {
  it("off and misconfigured say nobody was emailed", () => {
    for (const st of ["off", "misconfigured"] as const) {
      expect(notifyOutcome(st, "the volunteer")).toMatch(/has not been emailed/);
      expect(notifyOutcome(st, "them", true)).toMatch(/have not been emailed/);
      expect(notifyFuture(st, "volunteers")).toMatch(/will not be emailed/);
    }
  });
  it("limited says queued, not sent", () => {
    expect(notifyOutcome("limited", "the volunteer")).toMatch(/queued/);
    expect(notifyOutcome("limited", "the volunteer")).not.toMatch(/sent|on its way/);
  });
  it("uses 'them' after 'to' (never 'an email to they')", () => {
    expect(notifyFuture("limited", "they")).toBe("an email to them will be queued (pilot mode: approved addresses only)");
    expect(notifyFuture("off", "they")).toBe("they will not be emailed while email is off, so tell them yourself");
  });
  it("on says an email is on its way", () => {
    expect(notifyOutcome("on", "the volunteer")).toBe("An email to the volunteer is on its way.");
    expect(capitalise(notifyFuture("on", "anyone on it"))).toBe("Anyone on it will be emailed");
  });
});
