import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  decideAccess,
  decideHubAccess,
  homePathFor,
  hubHomePath,
  type AccessDecision,
  type AccessLevel,
  type AppRole,
  type HubAccessDecision,
  type HubMe,
  type HubPerson,
  type VolunteerRecord,
} from "@/lib/auth/access";

/**
 * Data Access Layer for identity. Every protected page, Server Action and Route Handler
 * calls one of these. Results are deliberately NOT cached: a suspension or role change
 * must take effect on the very next request. The database re-checks everything independently.
 */

async function verifiedAuthUserId() {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const authUserId = !error && claimsData?.claims?.sub ? String(claimsData.claims.sub) : null;
  return { supabase, authUserId };
}

// ---------------------------------------------------------------------------
// Volunteer Hub (people + portal accounts)
// ---------------------------------------------------------------------------
export async function resolveHubAccess(allowed?: readonly AccessLevel[]): Promise<HubAccessDecision> {
  const { supabase, authUserId } = await verifiedAuthUserId();
  if (!authUserId) return decideHubAccess(null, null, allowed);
  const { data } = await supabase.rpc("hub_me");
  return decideHubAccess(authUserId, (data ?? null) as HubMe, allowed);
}

function enforceHub(decision: HubAccessDecision): HubPerson {
  switch (decision.kind) {
    case "allow":
      return decision.person;
    case "signed_out":
      redirect("/login");
    case "no_access":
      redirect("/no-access");
    case "forbidden":
      redirect("/home");
  }
}

/** Any signed-in person with an enabled portal account. */
export async function requirePerson(): Promise<HubPerson> {
  return enforceHub(await resolveHubAccess());
}

/** Signed-in person at one of the given access levels. */
export async function requireLevel(levels: readonly AccessLevel[]): Promise<HubPerson> {
  return enforceHub(await resolveHubAccess(levels));
}

export { hubHomePath };

// ---------------------------------------------------------------------------
// Legacy rota (volunteers table). Kept so the retired screens still work behind LEGACY_ROTA_UI.
// ---------------------------------------------------------------------------
export async function resolveAccess(allowedRoles?: readonly AppRole[]): Promise<AccessDecision> {
  const { supabase, authUserId } = await verifiedAuthUserId();
  if (!authUserId) return decideAccess(null, null, allowedRoles);
  const { data } = await supabase
    .from("volunteers")
    .select("id, display_name, role, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  const volunteer: VolunteerRecord | null = data
    ? { id: data.id, displayName: data.display_name, role: data.role as AppRole, isActive: data.is_active }
    : null;
  return decideAccess(authUserId, volunteer, allowedRoles);
}

function enforce(decision: AccessDecision): VolunteerRecord {
  switch (decision.kind) {
    case "allow":
      return decision.volunteer;
    case "signed_out":
      redirect("/login");
    case "no_access":
      redirect("/no-access");
    case "forbidden":
      redirect("/rota");
  }
}

export async function requireVolunteer(): Promise<VolunteerRecord> {
  return enforce(await resolveAccess());
}

export async function requireRole(roles: readonly AppRole[]): Promise<VolunteerRecord> {
  return enforce(await resolveAccess(roles));
}

export { homePathFor };
