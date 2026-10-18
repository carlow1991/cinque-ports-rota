import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "Enter a valid email address." }));

// Supabase OTP length is configurable (6 by default, up to 10).
export const codeSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6,10}$/, { message: "Enter the code from your email (numbers only)." }));

export type LoginState =
  | { step: "email"; error?: string; email?: string; next?: string }
  | { step: "code"; email: string; notice: string; error?: string; next?: string };

/** Identical wording whether or not the address is invited, so the form never reveals who is on the club list. */
export const GENERIC_SENT_NOTICE =
  "If this email belongs to an invited club volunteer, we've sent a sign-in code. It can take a minute to arrive, so check your spam folder too.";

export const GENERIC_CODE_ERROR = "That code didn't work or has expired. Check it, or request a new one.";

export const NO_ACCESS_ERROR =
  "Your email is verified, but it isn't set up for the rota or the account is paused. Please contact a club organiser.";
