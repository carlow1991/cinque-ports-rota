import { describe, expect, it } from "vitest";
import { checkEnv } from "../../scripts/env-rules";

const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;
const good = {
  APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
  NEXT_PUBLIC_SITE_URL: "https://rota.cinqueportsfc.example",
  SUPABASE_SECRET_KEY: "sb_secret_abc123",
  AUTH_INVITES_ENABLED: "true",
  EMAIL_SENDING_ENABLED: "true",
  EMAIL_PROVIDER_API_KEY: "re_abc123",
  EMAIL_FROM_ADDRESS: "Cinque Ports FC Rota <rota@cinqueportsfc.example>",
  CRON_SECRET: "x".repeat(40),
};
const names = (e: Record<string, string | undefined>, level = "error") => checkEnv(e).filter((f) => f.level === level).map((f) => f.name);

describe("pre-deployment settings check", () => {
  it("a complete production setup passes", () => {
    expect(checkEnv(good)).toEqual([]);
  });
  it("never echoes a value in its findings", () => {
    const bad = { ...good, NEXT_PUBLIC_LEAK: "sb_secret_TOPSECRETVALUE", CRON_SECRET: "shortsecretvalue" };
    expect(JSON.stringify(checkEnv(bad))).not.toMatch(/TOPSECRETVALUE|shortsecretvalue/);
  });
  it("catches a secret key exposed to the browser", () => {
    expect(names({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_oops" })).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(names({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") })).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(names({ ...good, NEXT_PUBLIC_CRON_SECRET: "a" })).toContain("NEXT_PUBLIC_CRON_SECRET");
  });
  it("catches the secret and publishable keys swapped or duplicated", () => {
    expect(names({ ...good, SUPABASE_SECRET_KEY: "sb_publishable_abc123" })).toContain("SUPABASE_SECRET_KEY");
    expect(names({ ...good, SUPABASE_SECRET_KEY: jwt("anon") })).toContain("SUPABASE_SECRET_KEY");
  });
  it("requires https, a bare site address, and a known environment", () => {
    expect(names({ ...good, NEXT_PUBLIC_SITE_URL: "http://rota.example.org" })).toContain("NEXT_PUBLIC_SITE_URL");
    expect(names({ ...good, NEXT_PUBLIC_SITE_URL: "https://rota.example.org/login" })).toContain("NEXT_PUBLIC_SITE_URL");
    expect(names({ ...good, NEXT_PUBLIC_SITE_URL: "https://localhost:3000" })).toContain("NEXT_PUBLIC_SITE_URL");
    expect(names({ ...good, APP_ENV: "prod" })).toContain("APP_ENV");
  });
  it("email on needs a provider key, from address and a long cron secret", () => {
    const e = names({ ...good, EMAIL_PROVIDER_API_KEY: "", EMAIL_FROM_ADDRESS: "not an address", CRON_SECRET: "short" });
    expect(e).toEqual(expect.arrayContaining(["EMAIL_PROVIDER_API_KEY", "EMAIL_FROM_ADDRESS", "CRON_SECRET"]));
    expect(names({ ...good, EMAIL_SENDING_ENABLED: "yes" })).toContain("EMAIL_SENDING_ENABLED");
  });
  it("the test-only provider URL is refused on live sites", () => {
    expect(names({ ...good, EMAIL_API_BASE_URL: "http://127.0.0.1:54399/mail" })).toContain("EMAIL_API_BASE_URL");
  });
  it("staging: warns about an empty allow-list and about real invitations", () => {
    const w = names({ ...good, APP_ENV: "staging", NEXT_PUBLIC_SITE_URL: "https://rota-staging.vercel.app" }, "warn");
    expect(w).toEqual(expect.arrayContaining(["EMAIL_STAGING_ALLOWLIST", "AUTH_INVITES_ENABLED"]));
  });
  it("pilot mode: the real site, with email limited to the pilot group's allow-list", () => {
    expect(names({ ...good, APP_ENV: "pilot", EMAIL_STAGING_ALLOWLIST: "a@x.example,b@x.example" })).toEqual([]);
    expect(names({ ...good, APP_ENV: "pilot" }, "warn")).toContain("EMAIL_STAGING_ALLOWLIST");
  });
  it("a safe default (everything off) staging setup has no errors", () => {
    const e = { APP_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: "https://s.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_s",
      NEXT_PUBLIC_SITE_URL: "https://rota-staging.vercel.app", AUTH_INVITES_ENABLED: "false", EMAIL_SENDING_ENABLED: "false" };
    expect(names(e)).toEqual([]);
  });
});
