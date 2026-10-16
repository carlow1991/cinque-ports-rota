import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeSupabase, RedirectSignal, type FakeScenario } from "./fake-supabase";

let current: ReturnType<typeof makeFakeSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

const { requireVolunteer, requireRole } = await import("@/lib/auth/dal");
const { requestCode, verifyCode, loginAction } = await import("@/app/(auth)/login/actions");
const { GET: callback } = await import("@/app/auth/callback/route");
const { GENERIC_SENT_NOTICE, NO_ACCESS_ERROR } = await import("@/app/(auth)/login/schema");
const { MANAGER_ROLES } = await import("@/lib/auth/access");
const { NextRequest } = await import("next/server");

const ACTIVE_VOLUNTEER = { id: "v1", display_name: "Sam", role: "volunteer", is_active: true };
const ACTIVE_ADMIN = { id: "a1", display_name: "Ade", role: "admin", is_active: true };

function scenario(s: Partial<FakeScenario>) {
  current = makeFakeSupabase({ sub: "auth-uid-1", volunteer: ACTIVE_VOLUNTEER, ...s });
  return current;
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => scenario({}));

describe("server-side page guards (DAL)", () => {
  it("signed-out request → /login", async () => {
    scenario({ sub: null });
    expect(await redirectOf(requireVolunteer())).toBe("/login");
  });

  it("forged or expired session (getClaims fails) → /login, even if a row exists", async () => {
    scenario({ sub: null, volunteer: ACTIVE_ADMIN });
    expect(await redirectOf(requireRole(MANAGER_ROLES))).toBe("/login");
  });

  it("signed in but uninvited (no volunteer row) → /no-access", async () => {
    scenario({ volunteer: null });
    expect(await redirectOf(requireVolunteer())).toBe("/no-access");
  });

  it("suspended volunteer → /no-access on every guard, including an inactive admin", async () => {
    scenario({ volunteer: { ...ACTIVE_VOLUNTEER, is_active: false } });
    expect(await redirectOf(requireVolunteer())).toBe("/no-access");
    scenario({ volunteer: { ...ACTIVE_ADMIN, is_active: false } });
    expect(await redirectOf(requireRole(MANAGER_ROLES))).toBe("/no-access");
  });

  it("volunteer requesting an organiser page → bounced to /rota", async () => {
    expect(await redirectOf(requireRole(MANAGER_ROLES))).toBe("/rota");
  });

  it("admin passes the organiser guard", async () => {
    scenario({ volunteer: ACTIVE_ADMIN });
    await expect(requireRole(MANAGER_ROLES)).resolves.toMatchObject({ role: "admin", displayName: "Ade" });
  });

  it("loads the row by the VERIFIED session subject, never by client input", async () => {
    const s = scenario({ sub: "verified-sub" });
    await requireVolunteer();
    expect(s.calls.eqFilters).toEqual([["auth_user_id", "verified-sub"]]);
  });
});

describe("login: request code", () => {
  it("never allows Supabase to create an account (shouldCreateUser:false)", async () => {
    const s = scenario({});
    await requestCode({ step: "email" }, form({ email: "Sam@Example.org " }));
    expect(s.calls.signInWithOtp).toHaveBeenCalledTimes(1);
    const args = s.calls.signInWithOtp.mock.calls[0][0] as { email: string; options: { shouldCreateUser: boolean } };
    expect(args.email).toBe("sam@example.org");
    expect(args.options.shouldCreateUser).toBe(false);
  });

  it("gives the same response for invited and uninvited/failed addresses", async () => {
    scenario({});
    const ok = await requestCode({ step: "email" }, form({ email: "invited@example.org" }));
    scenario({ otpError: true });
    const failed = await requestCode({ step: "email" }, form({ email: "stranger@example.org" }));
    expect(ok).toEqual({ step: "code", email: "invited@example.org", notice: GENERIC_SENT_NOTICE });
    expect(failed).toEqual({ step: "code", email: "stranger@example.org", notice: GENERIC_SENT_NOTICE });
  });

  it("rejects a malformed email without calling Supabase", async () => {
    const s = scenario({});
    const r = await requestCode({ step: "email" }, form({ email: "not-an-email" }));
    expect(r.step).toBe("email");
    expect(s.calls.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("login: verify code", () => {
  const state = { step: "code" as const, email: "sam@example.org", notice: GENERIC_SENT_NOTICE };

  it("valid code + invited active volunteer → linked and sent home", async () => {
    const s = scenario({});
    expect(await redirectOf(verifyCode(state, form({ email: "sam@example.org", code: "123 456" })))).toBe("/rota");
    expect(s.calls.verifyOtp).toHaveBeenCalledWith({ email: "sam@example.org", token: "123456", type: "email" });
    expect(s.calls.rpc).toHaveBeenCalledWith("link_volunteer_account");
  });

  it("admin lands on /manage", async () => {
    scenario({ volunteer: ACTIVE_ADMIN });
    expect(await redirectOf(verifyCode(state, form({ email: "sam@example.org", code: "123456" })))).toBe("/manage");
  });

  it.each(["not_invited", "inactive", "unverified", "conflict"])(
    "link result %s → signed out with a no-access message",
    async (linkResult) => {
      const s = scenario({ linkResult });
      const r = await verifyCode(state, form({ email: "sam@example.org", code: "123456" }));
      expect(r).toEqual({ step: "email", error: NO_ACCESS_ERROR });
      expect(s.calls.signOut).toHaveBeenCalled();
    },
  );

  it("linked but then found inactive → signed out", async () => {
    const s = scenario({ linkResult: "already_linked", volunteer: { ...ACTIVE_VOLUNTEER, is_active: false } });
    const r = await verifyCode(state, form({ email: "sam@example.org", code: "123456" }));
    expect(r.step).toBe("email");
    expect(s.calls.signOut).toHaveBeenCalled();
  });

  it("wrong or expired code → stays on code step, no linking attempted", async () => {
    const s = scenario({ verifyOtpError: true });
    const r = await verifyCode(state, form({ email: "sam@example.org", code: "000000" }));
    expect(r).toMatchObject({ step: "code", error: expect.any(String) });
    expect(s.calls.rpc).not.toHaveBeenCalled();
  });

  it("loginAction dispatches on intent", async () => {
    const s = scenario({});
    await loginAction({ step: "email" }, form({ intent: "request", email: "a@example.org" }));
    expect(s.calls.signInWithOtp).toHaveBeenCalled();
    expect(s.calls.verifyOtp).not.toHaveBeenCalled();
  });
});

describe("/auth/callback", () => {
  const req = (qs: string) => new NextRequest(`https://rota.example.org/auth/callback?${qs}`);

  it("valid invite link for an invited volunteer → home", async () => {
    scenario({});
    const res = await callback(req("token_hash=abc&type=invite"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://rota.example.org/rota");
  });

  it("uninvited user arriving by link → signed out, /login?error=access", async () => {
    const s = scenario({ linkResult: "not_invited", volunteer: null });
    const res = await callback(req("token_hash=abc&type=magiclink"));
    expect(res.headers.get("location")).toBe("https://rota.example.org/login?error=access");
    expect(s.calls.signOut).toHaveBeenCalled();
  });

  it("expired link → /login?error=link", async () => {
    scenario({ verifyOtpError: true });
    const res = await callback(req("token_hash=abc&type=email"));
    expect(res.headers.get("location")).toBe("https://rota.example.org/login?error=link");
  });

  it("unknown OTP type is refused", async () => {
    const s = scenario({});
    const res = await callback(req("token_hash=abc&type=recovery"));
    expect(res.headers.get("location")).toBe("https://rota.example.org/login?error=link");
    expect(s.calls.verifyOtp).not.toHaveBeenCalled();
  });

  it("ignores an off-site next parameter (no open redirect)", async () => {
    scenario({});
    const res = await callback(req("token_hash=abc&type=email&next=https://evil.example"));
    expect(res.headers.get("location")).toBe("https://rota.example.org/rota");
  });
});
