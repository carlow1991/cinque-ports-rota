"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Organiser navigation (brief §2): four destinations plus New event as the primary action (in the bar
 * from tablet width; on phones it is a button on Overview and the Events pages, see NewEventButton).
 * Every old URL still works; this only changes how they are grouped. Active state uses weight and
 * an underline, not colour alone. Pages still enforce access themselves.
 */
const ITEMS = [
  { href: "/manage", label: "Overview", match: (p: string) => p === "/manage" },
  {
    href: "/manage/calendar", label: "Events",
    match: (p: string) => ["/manage/calendar", "/manage/coverage", "/manage/approvals", "/manage/shifts"].some((x) => p.startsWith(x))
      || (p.startsWith("/manage/events/") && p !== "/manage/events/new"),
  },
  { href: "/manage/volunteers", label: "Volunteers", match: (p: string) => p.startsWith("/manage/volunteers") },
  { href: "/manage/templates", label: "Setup", match: (p: string) => p.startsWith("/manage/templates") || p.startsWith("/manage/settings") },
] as const;

export function ManageNav() {
  return <ManageNavLinks pathname={usePathname()} />;
}

/** Same links with no "current page" marking: shown while the page address is being read. */
export function ManageNavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Organiser" className="mx-auto grid max-w-5xl grid-cols-4 items-center px-2 py-1 text-sm sm:flex sm:gap-x-1">
      {ITEMS.map((l) => {
        const active = pathname != null && l.match(pathname);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap px-1 text-club sm:px-2 ${
              active ? "font-bold underline decoration-accent decoration-4 underline-offset-8" : "font-semibold hover:underline"}`}>
            {l.label}
          </Link>
        );
      })}
      <Link href="/manage/events/new" aria-current={pathname === "/manage/events/new" ? "page" : undefined}
        className="ml-auto hidden min-h-11 items-center whitespace-nowrap rounded-lg bg-club px-3 font-semibold text-white hover:bg-club-hover sm:inline-flex">
        + New event
      </Link>
    </nav>
  );
}

type Tab = { key: string; href: string; label: string };

function Tabs({ label, tabs, current }: { label: string; tabs: Tab[]; current: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px inline-flex min-h-11 items-center border-b-4 px-3 text-sm ${
            t.key === current ? "border-accent font-bold text-club" : "border-transparent font-semibold text-ink-muted hover:text-club"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Switch between the views of events. Each tab keeps its own existing URL. */
export function EventsTabs({ current }: { current: "calendar" | "coverage" | "requests" }) {
  return <Tabs label="Event views" current={current} tabs={[
    { key: "calendar", href: "/manage/calendar", label: "Calendar" },
    { key: "coverage", href: "/manage/coverage", label: "Coverage" },
    { key: "requests", href: "/manage/approvals", label: "Requests" },
  ]} />;
}

/** Setup groups Templates and (administrators only) Settings. */
export function SetupTabs({ current, isAdmin }: { current: "templates" | "settings"; isAdmin: boolean }) {
  return <Tabs label="Setup" current={current} tabs={[
    { key: "templates", href: "/manage/templates", label: "Templates" },
    ...(isAdmin ? [{ key: "settings", href: "/manage/settings", label: "Settings" }] : []),
  ]} />;
}

/** Phone-width primary action, shown on Overview and the Events pages (the nav bar has it from sm up). */
export function NewEventButton() {
  return (
    <Link href="/manage/events/new"
      className="inline-flex min-h-11 items-center rounded-lg bg-club px-4 font-semibold text-white hover:bg-club-hover sm:hidden">
      + New event
    </Link>
  );
}
