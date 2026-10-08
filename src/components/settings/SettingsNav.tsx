"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/settings", label: "Store" },
  { href: "/settings/staff", label: "Staff" },
] as const;

// Switches between the settings pages. Both are owner-only and check that
// themselves.
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="border-b border-border">
      <ul className="-mb-px flex gap-6">
        {LINKS.map((link) => {
          const current = pathname === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "type-label flex h-11 items-center border-b-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  current
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
