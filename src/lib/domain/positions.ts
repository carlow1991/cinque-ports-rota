/** Club roles: occupancy and recruiting are separate facts and are always shown separately. */
export const OCCUPANCY_LABEL = { vacant: "Vacant", filled: "Filled", shared: "Shared" } as const;

export function recruitingLabels(p: { seeking_replacement: boolean; seeking_additional_help: boolean; publish_vacancy: boolean; occupancy: string }): string[] {
  const out: string[] = [];
  if (p.seeking_replacement) out.push(p.occupancy === "vacant" ? "Looking for someone" : "Looking for a successor");
  if (p.seeking_additional_help) out.push("Extra help wanted");
  if (p.publish_vacancy && p.occupancy === "vacant" && !p.seeking_replacement) out.push("Vacancy advertised");
  return out;
}

export const PUBLIC_REASON_LABEL = {
  successor: "Looking for a successor — training and handover offered",
  vacant: "Vacancy",
  extra_help: "Extra help wanted",
} as const;

export const INTEREST_STAGES = [
  { code: "interested", label: "Interested" },
  { code: "contacted", label: "Contacted" },
  { code: "discussion", label: "In discussion" },
  { code: "shadowing", label: "Shadowing" },
  { code: "handover", label: "Handover" },
  { code: "appointed", label: "Taken on (internal note only)" },
  { code: "withdrawn", label: "Withdrawn" },
  { code: "closed", label: "Closed" },
] as const;

export const LOCATION_LABEL: Record<string, string> = { onsite: "On site", remote: "From home", either: "On site or from home" };
