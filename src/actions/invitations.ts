"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { acceptInvitationSchema, INVITATION_MESSAGES } from "@/schemas/staff";
import { getAuth } from "@/server/auth/auth";
import { getSession, WORKSPACE_HOME_PATH } from "@/server/auth/session";
import type { AcceptInvitationResult } from "@/server/data/invitations";
import { acceptAsExistingAccount, acceptAsNewUser } from "@/server/services/invitations";

// Accepting a staff invitation (public: the private link is the credential).
// Acceptance never depends on who is signed in in this browser. The token
// arrives from the page's URL; it is never logged.

export type AcceptActionResult =
  | { ok: false; message: string; fieldErrors?: Record<string, string> }
  // Done, and the person signs in themselves: the page opens sign-in with the
  // email filled in, or, when someone else is signed in here (whose session
  // is left alone), asks them to sign in as this email. Never in a URL.
  | { ok: true; email: string; someoneElseSignedIn: boolean };

const FAILED = "Something went wrong. Please try again.";

const REFUSALS: Record<Exclude<AcceptInvitationResult, { ok: true }>["code"], string> = {
  INVALID: INVITATION_MESSAGES.invalid,
  EMAIL_IN_USE: INVITATION_MESSAGES.activeElsewhere,
  ACCOUNT_EXISTS: INVITATION_MESSAGES.accountExists,
  NO_ACCOUNT: INVITATION_MESSAGES.noAccount,
};

// New account: name and password; the email is the invitation's. The person
// is signed in and sent to the workspace only if nobody is signed in here.
export async function acceptInvitation(token: string, formData: FormData): Promise<AcceptActionResult> {
  const parsed = acceptInvitationSchema.safeParse({
    name: formData.get("name") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "")] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields and try again.", fieldErrors };
  }

  let result: AcceptInvitationResult;
  try {
    result = await acceptAsNewUser(String(token), parsed.data);
  } catch (error) {
    logFailure("accepting as a new user", error);
    return { ok: false, message: FAILED };
  }
  if (!result.ok) return { ok: false, message: REFUSALS[result.code] };

  if (await isAnyoneSignedIn()) return { ok: true, email: result.email, someoneElseSignedIn: true };

  try {
    // Sets the session cookie (nextCookies plugin).
    await getAuth().api.signInEmail({
      body: { email: result.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    // The account and membership exist; they can sign in themselves.
    logFailure("signing in after accepting", error);
    return { ok: true, email: result.email, someoneElseSignedIn: false };
  }
  redirect(WORKSPACE_HOME_PATH);
}

// Existing account: "Join" adds the membership without signing in; the page
// then opens sign-in with the email filled in.
export async function joinWithExistingAccount(token: string): Promise<AcceptActionResult> {
  let result: AcceptInvitationResult;
  try {
    result = await acceptAsExistingAccount(String(token));
  } catch (error) {
    logFailure("joining with an existing account", error);
    return { ok: false, message: FAILED };
  }
  if (!result.ok) return { ok: false, message: REFUSALS[result.code] };
  return { ok: true, email: result.email, someoneElseSignedIn: await isAnyoneSignedIn() };
}

// Only decides what happens after accepting; never used to accept.
async function isAnyoneSignedIn(): Promise<boolean> {
  try {
    return (await getSession()) !== null;
  } catch {
    // Unknown: leave any session alone and let the person sign in.
    return true;
  }
}

function logFailure(step: string, error: unknown): void {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  console.error(`[invitations] ${step} failed:`, `${error instanceof Error ? error.name : "unknown error"}${code}`);
}
