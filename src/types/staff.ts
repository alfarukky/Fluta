import type { StoreRole } from "@/generated/prisma/enums";

export type StaffStatus = "ACTIVE" | "DEACTIVATED" | "INVITED" | "INVITE_EXPIRED";

// One row of the staff list: a store member or an open invitation.
export interface StaffListEntry {
  kind: "member" | "invitation";
  // Membership ID or invitation ID.
  id: string;
  // Null for invitations (shown as "Invited").
  name: string | null;
  email: string;
  role: StoreRole;
  status: StaffStatus;
  // ISO timestamp: join date for members, invite date for invitations.
  date: string;
}
