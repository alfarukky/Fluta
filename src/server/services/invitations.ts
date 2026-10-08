import "server-only";

import {
  acceptInvitationAsNewUser,
  acceptInvitationForExistingAccount,
  findInvitationByTokenHash,
  type AcceptInvitationResult,
  type InvitationForAcceptance,
} from "@/server/data/invitations";
import { prepareUserWithPassword } from "@/server/data/users";
import { getInvitationStatus } from "@/server/domain/invitations";
import { hashToken, isWellFormedToken } from "@/lib/tokens";
import { getStoreAccess } from "@/server/domain/store-access";

// Accepting a staff invitation through its private link (/invite/[token]).
// The raw token is hashed straight away and never logged.

// The invitation behind a link, or null when the link can't be used: unknown,
// expired, revoked, replaced, already used, or its store can't take changes.
export async function findUsableInvitation(token: string, now = new Date()): Promise<InvitationForAcceptance | null> {
  if (!isWellFormedToken(token)) return null;
  const invitation = await findInvitationByTokenHash(hashToken(token));
  if (!invitation || getInvitationStatus(invitation, now) !== "INVITED") return null;

  const { subscription, ...store } = invitation.store;
  return getStoreAccess(store, subscription, now).canEditSettings ? invitation : null;
}

// Everything is checked again here at submit time, and the claim inside the
// transaction is the final word (src/server/data/invitations.ts).
export async function acceptAsNewUser(
  token: string,
  input: { name: string; password: string },
  now = new Date(),
): Promise<AcceptInvitationResult> {
  const invitation = await findUsableInvitation(token, now);
  if (!invitation) return { ok: false, code: "INVALID" };

  // The email is the invitation's, never one from the request.
  const { name, passwordHash } = await prepareUserWithPassword({ ...input, email: invitation.email });
  return acceptInvitationAsNewUser(hashToken(token), { name, passwordHash }, now);
}

// The invited email already has an account: it joins without signing in.
export async function acceptAsExistingAccount(token: string, now = new Date()): Promise<AcceptInvitationResult> {
  const invitation = await findUsableInvitation(token, now);
  if (!invitation) return { ok: false, code: "INVALID" };
  return acceptInvitationForExistingAccount(hashToken(token), now);
}
