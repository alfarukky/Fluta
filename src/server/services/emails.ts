import "server-only";

import { formatLongDate } from "@/lib/time";
import { INVITATION_VALID_DAYS } from "@/schemas/staff";
import { getMailer, type EmailMessage } from "@/server/integrations/email";

import { renderEmailHtml } from "./email-layout";

// Fluta's emails: short, starting with the store's name, with the link and
// when it expires. Each has a plain-text part and the same words laid out in
// HTML (src/server/services/email-layout.ts).

export const RESET_LINK_VALID_MINUTES = 60;

export function buildInvitationEmail(input: {
  to: string;
  storeName: string;
  inviterName: string;
  url: string;
  expiresAt: Date;
  timeZone: string;
}): EmailMessage {
  const invited = `${input.inviterName} invited you to join ${input.storeName} on Fluta as staff.`;
  const expiry = `This link works once and expires in ${INVITATION_VALID_DAYS} days, on ${formatLongDate(input.expiresAt, input.timeZone)}.`;
  const ignore = "If you weren't expecting this email, you can ignore it.";
  return {
    to: input.to,
    subject: `${input.storeName}: you're invited to join the store on Fluta`,
    text: [input.storeName, "", invited, "", "Accept the invitation:", input.url, "", expiry, ignore].join("\n"),
    html: renderEmailHtml({
      preview: invited,
      heading: input.storeName,
      paragraphs: [invited, "Accept the invitation to set up your account and start working in the store's workspace."],
      button: { label: "Accept invitation", url: input.url },
      smallPrint: [expiry, ignore],
      footer: `Sent by Fluta on behalf of ${input.storeName}.`,
    }),
  };
}

export function buildPasswordResetEmail(input: { to: string; storeName: string | null; url: string }): EmailMessage {
  const heading = input.storeName ?? "Fluta";
  const asked = "Someone asked to reset the password for your Fluta account.";
  const expiry = `This link works once and expires in ${RESET_LINK_VALID_MINUTES / 60} hour.`;
  const ignore = "If you didn't ask for this, you can ignore this email; your password stays the same.";
  return {
    to: input.to,
    subject: `${heading}: reset your Fluta password`,
    text: [heading, "", asked, "", "Choose a new password:", input.url, "", expiry, ignore].join("\n"),
    html: renderEmailHtml({
      preview: asked,
      heading,
      paragraphs: [asked, "Choose a new password with the button below. You'll be signed out on every device."],
      button: { label: "Choose a new password", url: input.url },
      smallPrint: [expiry, ignore],
      footer: input.storeName ? `Sent by Fluta for your ${input.storeName} account.` : "Sent by Fluta.",
    }),
  };
}

// Sends and reports whether it worked. Failures are logged without the
// address or the link (the link carries a token).
export async function trySendEmail(message: EmailMessage, kind: string): Promise<boolean> {
  try {
    await getMailer().send(message);
    return true;
  } catch (error) {
    console.error(`[email] sending the ${kind} email failed:`, error instanceof Error ? error.name : "unknown error");
    return false;
  }
}
