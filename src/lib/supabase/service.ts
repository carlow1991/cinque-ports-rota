import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Server-only client with the SECRET key, for the public (no-login) pages ONLY. The database lets this
 * key call just a handful of narrow functions (public opportunities, submit an application, the email
 * worker and first-admin bootstrap) and read no tables. Never import from client code.
 */
export function serviceClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return null;
  const { supabaseUrl } = publicEnv();
  return createClient(supabaseUrl, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type PublicOpportunity = {
  id: string; title: string; department: string | null; summary: string | null; responsibilities: string | null; commitment: string | null;
  location: "onsite" | "remote" | "either" | null; skills: string[]; training_available: boolean; checks_needed: boolean;
  reason: "successor" | "vacant" | "extra_help";
};

export async function loadPublicOpportunities(): Promise<PublicOpportunity[] | null> {
  const sb = serviceClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc("public_opportunities");
  if (error) return null;
  return (data ?? []) as PublicOpportunity[];
}

/** The club's contact address from Settings (falls back to CLUB_CONTACT_EMAIL, then a generic phrase). */
export async function loadClubContact(): Promise<string> {
  const sb = serviceClient();
  if (sb) {
    const { data } = await sb.rpc("public_club_contact");
    if (typeof data === "string" && data) return data;
  }
  return process.env.CLUB_CONTACT_EMAIL || "the club secretary";
}
