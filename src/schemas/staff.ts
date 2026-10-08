import { z } from "zod";

import { emailSchema, passwordSchema } from "./users";

// How long an invite link works (shown to owners, so not server-only).
export const INVITATION_VALID_DAYS = 7;

export const inviteStaffSchema = z.object({ email: emailSchema });

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
