"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Volunteer Hub navigation (spec 01 §3): Home | Calendar | People | Opportunities | My Profile,
 * plus Manage (organisers only, shown in the header). Active state uses weight + underline,
 * never colour alone. Pages enforce access themselves; navigation grants nothing.
 */
const MAIN = [
  { href: "/home", label: "Home" },
  { href: "/calendar", label: "Calendar" },
  { href: "/people", label: "People" },
  // Short visible words fit five tabs on a 320px phone; the hidden words complete the name for screen
  // readers while still starting with the visible text (WCAG 2.5.3, label in name).
  { href: "/opportunities", label: "Roles", more: " and opportunities" },
  { href: "/my-profile", label: "Me", more: " (my profile)" },
] as const;

export function HubBottomNav() {
  return <HubBottomNavLinks pathname={usePathname()} />;
}

export function HubBottomNavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] print:hidden">
      <ul className="mx-auto grid max-w-2xl grid-cols-5">
        {MAIN.map((item) => {
          const active = pathname != null && (pathname === item.href || pathname.startsWith(`${item.href}/`));
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? "page" : undefined}
                className={`flex min-h-14 items-center justify-center px-1 text-sm ${
                  active ? "font-bold text-club underline decoration-accent decoration-4 underline-offset-8" : "text-ink-muted"}`}>
                {item.label}{"more" in item ? <span className="sr-only">{item.more}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Organiser area (spec 01 §3). Wraps on small screens; no nested tab hierarchy. */
const MANAGE = [
  { href: "/manage", label: "Overview", exact: true },
  { href: "/manage/events", label: "Events" },
  { href: "/manage/people", label: "People" },
  { href: "/manage/requests", label: "Requests" },
  { href: "/manage/venue-cover", label: "Venue cover" },
  { href: "/manage/club-roles", label: "Club roles" },
  { href: "/manage/applications", label: "Applications" },
  { href: "/manage/settings", label: "Settings", adminOnly: true },
] as const;

export function HubManageNav({ isAdmin }: { isAdmin: boolean }) {
  return <HubManageNavLinks pathname={usePathname()} isAdmin={isAdmin} />;
}

export function HubManageNavLinks({ pathname, isAdmin }: { pathname: string | null; isAdmin: boolean }) {
  return (
    <nav aria-label="Organiser" className="mx-auto flex max-w-5xl flex-wrap gap-x-1 px-2 py-1 text-sm">
      {MANAGE.filter((l) => !("adminOnly" in l) || isAdmin).map((l) => {
        const active = pathname != null && ("exact" in l ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`));
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center whitespace-nowrap px-2 text-club ${
              active ? "font-bold underline decoration-accent decoration-4 underline-offset-8" : "font-semibold hover:underline"}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
