import type { StoreRole } from "@/generated/prisma/enums";

import type { NavHref } from "./nav-items";

// What the shell shows about the signed-in member, all taken from the
// membership requireStoreMember() returned.
export interface WorkspaceMember {
  userName: string;
  userEmail: string;
  role: StoreRole;
  storeName: string;
}

// Counts shown beside navigation items (the Orders item's open orders).
export type NavCounts = Partial<Record<NavHref, number>>;
