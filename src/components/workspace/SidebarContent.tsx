"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/brand/Logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { getInitials } from "@/lib/names";
import { cn } from "@/lib/utils";

import { getNavItems, isNavItemActive, ROLE_LABELS, type NavItem } from "./nav-items";
import type { WorkspaceMember } from "./types";

interface SidebarContentProps {
  member: WorkspaceMember;
  // Called when a link is followed, so the mobile sheet can close.
  onNavigate?: () => void;
}

// The sidebar's contents, shared by the desktop sidebar and the mobile sheet.
export function SidebarContent({ member, onNavigate }: SidebarContentProps) {
  const pathname = usePathname();
  const items = getNavItems(member.role);
  const roleLabel = ROLE_LABELS[member.role];

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <Link
        href="/overview"
        aria-label="Fluta, go to Overview"
        onClick={onNavigate}
        className="flex h-11 items-center rounded-md px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Logo />
      </Link>

      <div className="rounded-lg border border-border bg-background px-3 py-3">
        <p className="type-caption font-semibold tracking-wider text-muted-foreground uppercase">Workspace</p>
        <p className="type-label mt-1 truncate text-foreground">{member.storeName}</p>
        <p className="type-caption text-muted-foreground">{roleLabel} workspace</p>
      </div>

      <nav aria-label="Workspace" className="flex flex-1 flex-col justify-between gap-6">
        <NavList items={items.filter((item) => item.section === "main")} pathname={pathname} onNavigate={onNavigate} />
        <NavList items={items.filter((item) => item.section === "footer")} pathname={pathname} onNavigate={onNavigate} />
      </nav>

      <Separator />

      <div className="flex min-w-0 items-center gap-3 px-1">
        <Avatar size="lg">
          <AvatarFallback className="bg-accent font-semibold text-accent-foreground">
            {getInitials(member.userName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="type-label truncate text-foreground">{member.userName}</p>
          <p className="type-caption text-muted-foreground">{roleLabel}</p>
        </div>
      </div>
    </div>
  );
}

interface NavListProps {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}

function NavList({ items, pathname, onNavigate }: NavListProps) {
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "type-label flex h-11 items-center gap-3 rounded-lg px-3 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active && "bg-accent font-semibold text-accent-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
