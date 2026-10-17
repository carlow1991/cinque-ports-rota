import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, siteUrl } from "@/lib/env";

/**
 * Server-only ELEVATED client (secret key, bypasses RLS). Used for exactly one thing: sending a
 * Supabase Auth invitation email after an admin has added the volunteer through the normal,
 * RLS-checked admin_create_volunteer() function. Never import this from client code.
 */
export function authInvitesEnabled(): boolean {
  return process.env.AUTH_INVITES_ENABLED === "true" && Boolean(process.env.SUPABASE_SECRET_KEY);
}

export async function sendAuthInvite(email: string): Promise<"sent" | "already_registered" | "failed"> {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return "failed";
  const { supabaseUrl } = publicEnv();
  const admin = createClient(supabaseUrl, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${siteUrl()}/auth/callback` });
  if (!error) return "sent";
  if (/already/i.test(error.message)) return "already_registered";
  console.warn("[invite] auth invite failed", { status: error.status, code: error.code }); // never log the address
  return "failed";
}
