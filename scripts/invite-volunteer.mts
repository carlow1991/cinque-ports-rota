/**
 * Invite a volunteer from a trusted machine. Needed once, for the FIRST admin; after that admins
 * add people in the app (/manage/volunteers).
 *
 *   node --env-file=.env.local scripts/invite-volunteer.mts <email> "<Display Name>" [admin|coordinator|volunteer]
 *
 * 1. Creates (or re-activates) the volunteer via admin_bootstrap_volunteer() (secret key only).
 * 2. Sends the Supabase Auth invite email, which lands on /auth/callback.
 *
 * Runs ONLY on a trusted machine: it needs SUPABASE_SECRET_KEY, which bypasses RLS.
 * Never expose that key to the browser, commit it, or paste it into chat.
 */
import { createClient } from "@supabase/supabase-js";

const [, , rawEmail, rawName, rawRole = "volunteer"] = process.argv;
const ROLES = ["admin", "coordinator", "volunteer"] as const;
type Role = (typeof ROLES)[number];

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const email = (rawEmail ?? "").trim().toLowerCase();
const displayName = (rawName ?? "").trim();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Usage: <email> \"<Display Name>\" [role]. A valid email is required.");
if (!displayName || displayName.length > 80) fail("Display name is required (max 80 characters).");
if (!ROLES.includes(rawRole as Role)) fail(`Role must be one of: ${ROLES.join(", ")}`);
const role = rawRole as Role;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
if (!url || !secret) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (use --env-file=.env.local).");

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

// The secret key can only call this one function on the club's tables (least privilege, Phase 7).
const { data: res, error: saveErr } = await admin.rpc("admin_bootstrap_volunteer", {
  p_email: email, p_display_name: displayName, p_role: role,
});
if (saveErr) fail(`Could not save the volunteer: ${saveErr.details || saveErr.message}`);
const existing = res as { volunteer_id: string; already_linked: boolean; existing: boolean };

if (existing.already_linked) {
  console.log(`✔ ${displayName} already has an account. Access updated (role: ${role}). They can sign in at ${site}/login`);
  process.exit(0);
}

const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/auth/callback` });
if (inviteErr) {
  if (/already/i.test(inviteErr.message)) {
    console.log(`✔ Volunteer row ready. An Auth user already exists for this address, so they can sign in at ${site}/login`);
    process.exit(0);
  }
  fail(`Volunteer row saved, but the invite email failed: ${inviteErr.message}`);
}
console.log(`✔ Invited ${displayName} (${role}). They'll receive an email to join.`);
