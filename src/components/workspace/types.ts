import type { StoreRole } from "@/generated/prisma/enums";

// What the shell shows about the signed-in member, all taken from the
// membership requireStoreMember() returned.
export interface WorkspaceMember {
  userName: string;
  userEmail: string;
  role: StoreRole;
  storeName: string;
}
