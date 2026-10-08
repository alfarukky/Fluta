import { ShieldAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";

import { SignOutButton } from "./SignOutButton";

type DeniedReason =
  | "NO_ACTIVE_MEMBERSHIP"
  | "MEMBERSHIP_CONFLICT"
  | "ROLE_NOT_PERMITTED"
  | "STORE_UNAVAILABLE"
  | "EDITING_NOT_ALLOWED"
  | "NOT_FLUTA_ADMIN";

const DESCRIPTIONS: Record<DeniedReason, string> = {
  NO_ACTIVE_MEMBERSHIP:
    "Your account isn't an active member of a store. Ask the store owner to invite you again, or sign in with another account.",
  MEMBERSHIP_CONFLICT: "There's a problem with your account's store access. Contact Fluta support for help.",
  ROLE_NOT_PERMITTED: "Only the store owner can open this page.",
  STORE_UNAVAILABLE: "This store's workspace is unavailable. Contact Fluta support for help.",
  EDITING_NOT_ALLOWED: "This store can't be changed right now. Contact Fluta support for help.",
  NOT_FLUTA_ADMIN: "This page is for Fluta administrators only.",
};

// The 403 page for a signed-in user who may not open this page.
export function AccessDenied({ reason }: { reason: DeniedReason }) {
  return (
    <main className="page-container flex flex-1 items-center justify-center py-section">
      <EmptyState
        icon={ShieldAlertIcon}
        title="You don't have access"
        description={DESCRIPTIONS[reason]}
        action={<SignOutButton />}
        className="w-full max-w-md"
      />
    </main>
  );
}
