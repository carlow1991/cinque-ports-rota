/**
 * Pure access decisions, kept free of Next.js and Supabase so they can be unit-tested exhaustively.
 * The database (RLS + SECURITY DEFINER helpers) enforces the same rules independently.
 */
export type AppRole = "admin" | "coordinator" | "volunteer";

export type VolunteerRecord = {
  id: string;
  displayName: string;
  role: AppRole;
  isActive: boolean;
};

export type AccessDecision =
  | { kind: "allow"; volunteer: VolunteerRecord }
  | { kind: "signed_out" } // no valid session → /login
  | { kind: "no_access" } // signed in but not an active, linked volunteer → /no-access
  | { kind: "forbidden" }; // active volunteer without the required role → their home page

export const MANAGER_ROLES: readonly AppRole[] = ["admin", "coordinator"];

export function decideAccess(
  authUserId: string | null,
  volunteer: VolunteerRecord | null,
  allowedRoles?: readonly AppRole[],
): AccessDecision {
  if (!authUserId) return { kind: "signed_out" };
  if (!volunteer || !volunteer.isActive) return { kind: "no_access" };
  if (allowedRoles && !allowedRoles.includes(volunteer.role)) return { kind: "forbidden" };
  return { kind: "allow", volunteer };
}

/** Where a signed-in volunteer lands by default. */
export function homePathFor(role: AppRole): string {
  return MANAGER_ROLES.includes(role) ? "/manage" : "/rota";
}

export type LinkResult = "linked" | "already_linked" | "not_invited" | "inactive" | "unverified" | "conflict";

export function linkAllowsEntry(result: string | null | undefined): boolean {
  return result === "linked" || result === "already_linked";
}
