"use client";

import { useActionState, useEffect, useRef } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { loginAction } from "./actions";
import type { LoginState } from "./schema";

const initial: LoginState = { step: "email" };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initial);
  const ready = useHydrated();

  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.step === "code") codeInput.current?.focus();
  }, [state.step]);

  if (state.step === "code") {
    return (
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="intent" value="verify" />
        <p role="status" className="rounded-lg bg-surface-muted p-3 text-sm text-ink">
          {state.notice}
        </p>
        <input type="hidden" name="email" value={state.email} />
        <div className="space-y-1">
          <label htmlFor="code" className="block text-sm font-semibold">
            Sign-in code sent to <span className="break-all">{state.email}</span>
          </label>
          <input
            ref={codeInput}
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={12}
            required
            aria-invalid={Boolean(state.error)}
            aria-describedby={state.error ? "code-error" : undefined}
            className={`block w-full rounded-lg border bg-white px-3 py-3 text-center text-2xl tracking-[0.3em] tabular-nums ${state.error ? "border-2 border-danger" : "border-line"}`}
          />
          {state.error ? (
            <p id="code-error" role="alert" className="text-sm font-medium text-danger">
              {state.error}
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={pending || !ready}
          className="w-full rounded-lg bg-club px-4 py-3 text-base font-semibold text-white hover:bg-club-hover disabled:opacity-60"
        >
          {!ready ? "Loading…" : pending ? "Checking…" : "Sign in"}
        </button>
        <p className="text-sm text-ink-muted">
          You can also tap the link in the email. Wrong address or no email?{" "}
          <a href="/login" className="font-semibold text-club-blue underline">
            Start again
          </a>
        </p>
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="intent" value="request" />
      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-semibold">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={state.email}
          required
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? "email-error" : "email-hint"}
          className={`block w-full rounded-lg border bg-white px-3 py-3 text-base ${state.error ? "border-2 border-danger" : "border-line"}`}
        />
        {state.error ? (
          <p id="email-error" role="alert" className="text-sm font-medium text-danger">
            {state.error}
          </p>
        ) : (
          <p id="email-hint" className="text-sm text-ink-muted">
            Use the email address the club invited.
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending || !ready}
        className="w-full rounded-lg bg-club px-4 py-3 text-base font-semibold text-white hover:bg-club-hover disabled:opacity-60"
      >
        {!ready ? "Loading…" : pending ? "Sending…" : "Email me a sign-in code"}
      </button>
    </form>
  );
}
