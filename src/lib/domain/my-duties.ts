/** Pure grouping of a volunteer's own duties into the My Duties tabs. */
export type DutyLike = { status: string; ends_at: string; starts_at: string; status_changed_at: string };

export const MY_DUTY_TABS = [
  { key: "confirmed", label: "Confirmed" },
  { key: "invited", label: "Awaiting response" },
  { key: "pending", label: "Pending approval" },
  { key: "past", label: "Past" },
] as const;
export type MyDutyTab = (typeof MY_DUTY_TABS)[number]["key"];

export function groupMyDuties<T extends DutyLike>(duties: T[], now: number) {
  const upcoming = (d: T) => new Date(d.ends_at).getTime() > now;
  const groups: Record<MyDutyTab, T[]> = {
    confirmed: duties.filter((d) => d.status === "confirmed" && upcoming(d)),
    invited: duties.filter((d) => d.status === "invited" && upcoming(d)),
    pending: duties.filter((d) => d.status === "pending_approval" && upcoming(d)),
    past: duties.filter((d) => d.status === "confirmed" && !upcoming(d)).reverse(),
  };
  // Cancellations/removals of upcoming duties in the last 14 days, so nobody turns up for a cancelled duty.
  const recentChanges = duties.filter(
    (d) => (d.status === "cancelled" || d.status === "removed") && upcoming(d) && now - new Date(d.status_changed_at).getTime() < 14 * 86400_000,
  );
  return { groups, recentChanges };
}

/** Default tab: invitations first if any are waiting, else confirmed. */
export function pickTab(requested: unknown, groups: Record<MyDutyTab, unknown[]>): MyDutyTab {
  if (typeof requested === "string" && MY_DUTY_TABS.some((t) => t.key === requested)) return requested as MyDutyTab;
  return groups.invited.length ? "invited" : "confirmed";
}
