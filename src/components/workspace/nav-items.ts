import {
  ChartColumnIcon,
  ClipboardListIcon,
  LayoutGridIcon,
  type LucideIcon,
  ShirtIcon,
  SlidersHorizontalIcon,
  TruckIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";

import type { StoreRole } from "@/generated/prisma/enums";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: readonly StoreRole[];
  // "footer" items sit near the bottom of the sidebar.
  section: "main" | "footer";
}

const ANY_MEMBER = ["OWNER", "STAFF"] as const;
const OWNER_ONLY = ["OWNER"] as const;

// The only list of workspace pages, in sidebar order. Hiding an item is UX
// only: every page checks the member's role itself.
const NAV = {
  "/overview": { label: "Overview", icon: LayoutGridIcon, roles: ANY_MEMBER, section: "main" },
  "/orders": { label: "Orders", icon: ClipboardListIcon, roles: ANY_MEMBER, section: "main" },
  "/customers": { label: "Customers", icon: UsersIcon, roles: ANY_MEMBER, section: "main" },
  "/payments": { label: "Payments", icon: WalletIcon, roles: ANY_MEMBER, section: "main" },
  "/services": { label: "Services", icon: ShirtIcon, roles: OWNER_ONLY, section: "main" },
  "/fulfilment": { label: "Fulfilment", icon: TruckIcon, roles: OWNER_ONLY, section: "main" },
  "/reports": { label: "Reports", icon: ChartColumnIcon, roles: OWNER_ONLY, section: "main" },
  "/settings": { label: "Settings", icon: SlidersHorizontalIcon, roles: OWNER_ONLY, section: "footer" },
} satisfies Record<string, Omit<NavItem, "href">>;

// A path that is in the navigation; anything else fails type-checking.
export type NavHref = keyof typeof NAV;

export const NAV_ITEMS: readonly NavItem[] = Object.entries(NAV).map(([href, item]) => ({ href, ...item }));

export function getNavItem(href: NavHref): NavItem {
  return { href, ...NAV[href] };
}

export const SETTINGS_PATH: NavHref = "/settings";

export function getNavItems(role: StoreRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function isNavItemActive(item: Pick<NavItem, "href">, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export const ROLE_LABELS: Record<StoreRole, string> = { OWNER: "Owner", STAFF: "Staff" };
