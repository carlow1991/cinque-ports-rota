import "server-only";

/**
 * Counts for "Needs attention" that belong to later stages (applications, club roles). Returns zeros
 * until those features exist; replaced in Stage 5/6 by real counts.
 */
export async function loadAttention(): Promise<{ new_applications: number; roles_recruiting: number }> {
  return { new_applications: 0, roles_recruiting: 0 };
}
