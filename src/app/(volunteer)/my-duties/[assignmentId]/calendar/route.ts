import { NextResponse, type NextRequest } from "next/server";
import { resolveAccess } from "@/lib/auth/dal";
import { loadMyDuties } from "@/lib/data/volunteer";
import { buildIcs } from "@/lib/ics";

/** Calendar file for one of the caller's OWN confirmed duties (looked up via my_duties(), so never anyone else's). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/my-duties/[assignmentId]/calendar">) {
  const access = await resolveAccess();
  if (access.kind !== "allow") return new NextResponse("Not found", { status: 404 });
  const { assignmentId } = await ctx.params;
  const duty = (await loadMyDuties()).find((d) => d.assignment_id === assignmentId && d.status === "confirmed");
  if (!duty) return new NextResponse("Not found", { status: 404 });

  const body = buildIcs({
    uid: duty.assignment_id,
    start: new Date(duty.starts_at),
    end: new Date(duty.ends_at),
    summary: `${duty.duty_name}: ${duty.event_title}`,
    location: [duty.venue_name, duty.venue_address].filter(Boolean).join(", "),
    description: [
      duty.responsibilities.length ? `Includes: ${duty.responsibilities.join(", ")}` : null,
      duty.shift_instructions,
      "Cinque Ports FC volunteer rota",
    ].filter(Boolean).join("\n"),
  });
  return new NextResponse(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="cinque-ports-duty.ics"`,
      "cache-control": "private, no-store",
    },
  });
}
