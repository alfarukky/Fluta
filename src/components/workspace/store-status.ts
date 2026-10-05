import type { StoreRole, StoreStatus } from "@/generated/prisma/enums";
import type { StoreAccess } from "@/server/domain/store-access";

export interface StoreStatusSummary {
  label: string;
  variant: "success" | "warning" | "error";
  description: string;
}

const ACTIVE: StoreStatusSummary = {
  label: "Active",
  variant: "success",
  description: "Your store is open for new orders.",
};

// What the workspace says about the store, from its operational status and
// getStoreAccess. When several apply, the most restrictive wins: Paused →
// Suspended → Overdue → Active. Billing is the owner's concern, so staff never
// see Overdue and see Suspended as "Not taking new bookings". Deactivated
// stores and cancelled subscriptions never reach the workspace
// (requireStoreMember refuses them).
export function summarizeStoreStatus(
  storeStatus: StoreStatus,
  access: StoreAccess,
  role: StoreRole,
): StoreStatusSummary {
  const isOwner = role === "OWNER";
  if (storeStatus === "PAUSED") {
    return {
      label: "Paused",
      variant: "warning",
      description: "Fluta has paused new orders. You can still work on existing orders.",
    };
  }
  if (access.subscriptionStatus === "SUSPENDED") {
    if (!isOwner) {
      return {
        label: "Not taking new bookings",
        variant: "error",
        description: "The store can't take new orders right now. You can still work on existing orders.",
      };
    }
    return {
      label: "Suspended",
      variant: "error",
      description: "Your subscription is suspended. You can work on existing orders but can't take new ones.",
    };
  }
  if (access.subscriptionStatus === "OVERDUE" && isOwner) {
    return {
      label: "Overdue",
      variant: "warning",
      description: "Your store is open, but a Fluta invoice is overdue. Pay it to avoid suspension.",
    };
  }
  return ACTIVE;
}
