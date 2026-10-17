"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/env";
import { log } from "@/lib/log";
import { linkAllowsEntry, homePathFor } from "@/lib/auth/access";
import { resolveAccess } from "@/lib/auth/dal";
import {
  codeSchema,
  emailSchema,
  GENERIC_CODE_ERROR,
  GENERIC_SENT_NOTICE,
  NO_ACCESS_ERROR,
  type LoginState,
} from "./schema";

/**
 * Step 1: ask Supabase to email a one-time code.
 * shouldCreateUser:false means an uninvited address can never create an account.
 * The response is identical for invited, uninvited and failed requests.
 */
export async function requestCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = formData.get("email");
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      step: "email",
      error: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
      email: typeof raw === "string" ? raw.slice(0, 254) : undefined,
    };
  }
  const email = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${siteUrl()}/auth/callback`,
    },
  });
  if (error) {
    // Log the category only, never the address.
    log.warn("auth", "otp request not sent", { status: error.status, code: error.code });
  }

  return { step: "code", email, notice: GENERIC_SENT_NOTICE };
}

/**
 * Step 2: verify the code, link the Auth user to the pre-created volunteer row
 * (server-side, by verified email only), then route by role.
 */
export async function verifyCode(prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { step: "email", error: "Please start again with your email address." };

  const back: LoginState = { step: "code", email: email.data, notice: prev.step === "code" ? prev.notice : GENERIC_SENT_NOTICE };

  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success) return { ...back, error: code.error.issues[0]?.message ?? GENERIC_CODE_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: "email" });
  if (error) return { ...back, error: GENERIC_CODE_ERROR };

  const { data: linkResult, error: linkError } = await supabase.rpc("link_volunteer_account");
  if (linkError || !linkAllowsEntry(linkResult as string)) {
    await supabase.auth.signOut();
    return { step: "email", error: NO_ACCESS_ERROR };
  }

  const access = await resolveAccess();
  if (access.kind !== "allow") {
    await supabase.auth.signOut();
    return { step: "email", error: NO_ACCESS_ERROR };
  }
  redirect(homePathFor(access.volunteer.role));
}

/** Single entry point for the login form: dispatches on the hidden "intent" field. */
export async function loginAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  return formData.get("intent") === "verify" ? verifyCode(prev, formData) : requestCode(prev, formData);
}
