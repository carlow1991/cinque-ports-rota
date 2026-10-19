import { NextResponse, type NextRequest } from "next/server";
import { resolveHubAccess } from "@/lib/auth/dal";
import { HUB_ADMIN } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";
import { log } from "@/lib/log";

/**
 * Administrator exports (monthly backup, subject-access requests). Read through the admin's own
 * session, so RLS applies. Audited. Never cached.
 */
const EXPORTS: Record<string, { table: string; columns: string[]; order: string }> = {
  people: { table: "people", order: "full_name", columns: ["id", "full_name", "display_name", "email_normalized", "phone_normalized", "preferred_contact_channel",
    "involvement", "lifecycle_status", "routine_requests_enabled", "directory_visibility", "share_email_with_members", "share_phone_with_members", "is_under_18", "created_at"] },
  applications: { table: "volunteer_applications", order: "created_at", columns: ["id", "created_at", "stage", "full_name", "email_normalized", "phone_normalized",
    "contact_preference", "existing_club_connection", "interests", "unsure_role", "strengths", "willing_to_learn", "commitment_bucket", "commitment_pattern",
    "work_location_preference", "availability", "privacy_notice_version", "communication_opt_in", "duplicate_review_status", "linked_person_id", "follow_up_on", "retention_review_at"] },
  events: { table: "events", order: "starts_at", columns: ["id", "title", "category", "status", "starts_at", "ends_at", "kickoff_at", "venue_id", "external_location_text",
    "team_id", "volunteers_enabled", "cancel_reason", "created_at"] },
  commitments: { table: "hub_assignments", order: "created_at", columns: ["id", "person_id", "scope", "event_id", "venue_id", "responsibility_label", "begins_at", "ends_at",
    "state", "invitation_source", "response_source", "recorded_by_person_id", "responded_at", "cancel_reason", "created_at"] },
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const access = await resolveHubAccess(HUB_ADMIN);
  if (access.kind !== "allow") return new NextResponse("Not found", { status: 404 });
  const { kind } = await params;
  const spec = EXPORTS[kind];
  if (!spec) return new NextResponse("Not found", { status: 404 });
  const sb = await createClient();
  const { data, error } = await sb.from(spec.table).select(spec.columns.join(", ")).order(spec.order);
  if (error) return new NextResponse("Export failed", { status: 500 });
  await sb.rpc("hub_log_export", { p_kind: kind, p_rows: (data ?? []).length });
  log.info("export", "admin export", { kind, rows: (data ?? []).length });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv((data ?? []) as unknown as Record<string, unknown>[], spec.columns), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="cinque-ports-${kind}-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
