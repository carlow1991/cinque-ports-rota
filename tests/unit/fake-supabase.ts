import { vi } from "vitest";

/** Scenario-driven stand-in for the per-request Supabase client used on the server. */
export type FakeScenario = {
  /** Verified JWT subject, or null when getClaims fails / no session. */
  sub: string | null;
  /** The row RLS would return for the caller (null = none visible). */
  volunteer: { id: string; display_name: string; role: string; is_active: boolean } | null;
  linkResult?: string;
  verifyOtpError?: boolean;
  otpError?: boolean;
};

export function makeFakeSupabase(s: FakeScenario) {
  const calls = {
    signInWithOtp: vi.fn(async (_args: unknown) => ({ data: {}, error: s.otpError ? { status: 429, code: "over_email_send_rate_limit" } : null })),
    verifyOtp: vi.fn(async (_args: unknown) => ({ data: {}, error: s.verifyOtpError ? { status: 403, code: "otp_expired" } : null })),
    exchangeCodeForSession: vi.fn(async (_code: string) => ({ data: {}, error: s.verifyOtpError ? { status: 400 } : null })),
    signOut: vi.fn(async () => ({ error: null })),
    rpc: vi.fn(async (_fn: string) => ({ data: s.linkResult ?? "linked", error: null })),
    eqFilters: [] as Array<[string, unknown]>,
  };

  const client = {
    auth: {
      getClaims: vi.fn(async () =>
        s.sub ? { data: { claims: { sub: s.sub } }, error: null } : { data: null, error: { message: "no session" } },
      ),
      signInWithOtp: calls.signInWithOtp,
      verifyOtp: calls.verifyOtp,
      exchangeCodeForSession: calls.exchangeCodeForSession,
      signOut: calls.signOut,
    },
    rpc: calls.rpc,
    from: vi.fn((_table: string) => {
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          calls.eqFilters.push([col, val]);
          return builder;
        },
        maybeSingle: async () => {
          // Emulate RLS: only the caller's own ACTIVE row is ever visible.
          const v = s.volunteer && s.volunteer.is_active ? s.volunteer : null;
          return { data: v, error: null };
        },
      };
      return builder;
    }),
  };
  return { client, calls };
}

/** Make next/navigation redirect() observable: it throws like the real one. */
export class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}
