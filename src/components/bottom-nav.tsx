"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/rota", label: "Rota" },
  { href: "/my-duties", label: "My Duties" },
  { href: "/profile", label: "Profile" },
] as const;

/** Phone-first bottom navigation. Active state uses weight + underline, not colour alone. */
export function BottomNav() {
  return <BottomNavLinks pathname={usePathname()} />;
}

/** Same links with no "current page" marking: shown while the page address is being read. */
export function BottomNavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-3">
        {ITEMS.map((item) => {
          const active = pathname != null && (pathname === item.href || pathname.startsWith(`${item.href}/`));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 items-center justify-center px-2 text-sm ${
                  active ? "font-bold text-club underline decoration-accent decoration-4 underline-offset-8" : "text-ink-muted"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
