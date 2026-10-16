import { z } from "zod";

import type { StoreRole } from "@/generated/prisma/enums";

import { emailSchema, passwordSchema } from "./users";

// How long an invite link works (shown to owners, so not server-only).
export const INVITATION_VALID_DAYS = 7;

// Owners invite staff or riders. Owners themselves are added only by Fluta
// admins, so OWNER is never accepted here.
export const INVITABLE_ROLES = ["STAFF", "RIDER"] as const satisfies readonly StoreRole[];
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const inviteStaffSchema = z.object({
  email: emailSchema,
  role: z.enum(INVITABLE_ROLES, { error: "Choose Staff or Rider" }).default("STAFF"),
});

// "You've been invited to join {store} as …"
const INVITED_AS: Record<StoreRole, string> = { OWNER: "the Owner", STAFF: "Staff", RIDER: "a Rider" };

export function describeInvitedRole(role: StoreRole): string {
  return INVITED_AS[role];
}

export const acceptInvitationSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100, "Use at most 100 characters"),
  password: passwordSchema,
});

// A membership or invitation ID from the client; whether it belongs to the
// owner's store is checked in the database.
export const recordIdSchema = z.string().min(1).max(64);

// One message per outcome, shared by the actions and the acceptance page.
export const STAFF_MESSAGES = {
  emailInUse: "This email can't be invited. It may already be in use.",
  pendingInvitation: "This email already has a pending invitation. Resend it instead.",
  invitationSent: "Invitation sent",
  invitationEmailFailed: "Invitation created, but the email couldn't be sent. Copy the link to share it.",
  newInvitationSent: "New invitation sent",
  newInvitationEmailFailed: "New invitation created, but the email couldn't be sent. Copy the link to share it.",
  invitationNotFound: "This invitation can't be changed. It may have been accepted or revoked.",
  invitationRevoked: "Invitation revoked",
  staffNotFound: "This staff member can't be changed. Refresh the page and try again.",
  activeElsewhere: "This person now has access to another store, so they can't be reactivated here.",
} as const;

export const INVITATION_MESSAGES = {
  invalid: "This invitation is no longer valid. Ask the store owner for a new one.",
  activeElsewhere: "This email already has access to a store on Fluta, so it can't accept this invitation.",
  accountExists: "An account already exists for this email. Reload the page to join with it.",
  noAccount: "There's no account for this email yet. Reload the page to create one.",
} as const;
