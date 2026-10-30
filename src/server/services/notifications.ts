import "server-only";

import { after } from "next/server";
import { z } from "zod";

import type { OrderStage } from "@/generated/prisma/client";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  isCustomerMessageTemplate,
  isFinallyFailed,
  isLinkTemplate,
  MESSAGE_TEMPLATES,
  type CustomerMessageTemplate,
  type EmailMessageTemplate,
} from "@/lib/messages";
import { formatOrderNumber } from "@/lib/orders";
import { formatPhone, isNigerianNumber } from "@/lib/phone";
import { generateToken, hashToken } from "@/lib/tokens";
import { getTrackingUrl } from "@/lib/tracking-link";
import {
  claimMessage,
  clearOldBookingIpHashes,
  clearOldPickupLocations,
  failStuckMessages,
  findDueMessages,
  findOrderMessage,
  markMessageFailed,
  markMessageNotNeeded,
  markMessageSent,
  queueMessagesForOrder,
  recordWhatsAppOpened,
  type ClaimedMessage,
  type MessageContext,
  type MessageRequest,
  type NewMessage,
  type QueuedMessages,
} from "@/server/data/messages";
import { isUniqueViolation } from "@/server/data/errors";
import { findReminderOrder, findReviewReminderCandidates } from "@/server/data/reviews";
import { findLinkOrder } from "@/server/data/tracking";
import { findStoreCommunicationSettings } from "@/server/data/stores";
import {
  chooseDestinations,
  composeEmail,
  composeMessageText,
  composeWhatsAppText,
  emailText,
  getBookingSmsCapDecision,
  getStageMessageTemplate,
  getWhatsAppUrl,
} from "@/server/domain/messages";
import { isReviewReminderDue, isReviewReminderStillNeeded } from "@/server/domain/reviews";
import { getMailer } from "@/server/integrations/email";
import { getSmsProvider } from "@/server/integrations/sms";
import { TermiiError } from "@/server/integrations/termii";

import { renderEmailHtml } from "./email-layout";
import { trySendEmail } from "./emails";
import { canIssueTrackingLink, LINK_EXPIRED_MESSAGE } from "./tracking-links";

// Customer messages: what each trigger queues (an Order link, a Price update,
// Ready, or On its way, by SMS and email), sending them after the commit,
// the scheduled retries, and the staff actions on the order page. Callers
// queue through the data layer, in the transaction of the change itself.

// ───────────── What a trigger queues ─────────────

export interface CustomerMessageOptions {
  template: CustomerMessageTemplate;
  // The staff member whose action sends it. Null only for a customer's
  // online booking, the one message the daily cap counts.
  createdByUserId: string | null;
  // The two link messages: the link's raw token. `stored` when the order
  // already holds its hash (a new order's own token). Otherwise its hash is
  // stored with the messages, so the link is fresh and the old one stops
  // working, but only if a message is actually queued.
  link?: { token: string; stored: boolean };
  // Only these channels (Send again).
  channels?: readonly NewMessage["channel"][];
  // Book and pay's order link (plan 3.2): always emailed, to the email typed
  // for this booking, whatever the store's email copies setting says.
  alwaysEmailTo?: string;
}

export function customerMessages(options: CustomerMessageOptions): MessageRequest {
  if (isLinkTemplate(options.template) !== (options.link !== undefined)) {
    throw new Error(`The ${options.template} message ${options.link ? "has no" : "needs a"} link.`);
  }
  const bookingSms = options.template === MESSAGE_TEMPLATES.orderLink && options.createdByUserId === null;

  return {
    countBookingSms: bookingSms,
    createdByUserId: options.createdByUserId,
    plan: (context) => {
      const cap =
        bookingSms && context.bookingSmsToday !== null
          ? getBookingSmsCapDecision(context.bookingSmsToday, context.store.dailyBookingSmsCap)
          : { allowed: true, alert: false };
      const destinations = chooseDestinations({
        customerPhone: context.customer.phone,
        customerEmail: options.alwaysEmailTo ?? context.customer.email,
        smsEnabled: context.store.smsEnabled,
        emailCopiesEnabled: context.store.emailCopiesEnabled,
        smsWithinCap: cap.allowed,
        alwaysEmail: options.alwaysEmailTo !== undefined,
      }).filter((destination) => !options.channels || options.channels.includes(destination.channel));

      const link = options.link ? getTrackingUrl(options.link.token) : null;
      const messages = destinations.map(
        (destination): NewMessage => ({
          ...destination,
          template: options.template,
          body: renderBody(destination.channel, options.template, context, link),
        }),
      );
      return {
        messages,
        newTokenHash: options.link && !options.link.stored && messages.length > 0 ? hashToken(options.link.token) : null,
        capAlert: cap.alert && messages.some((message) => message.channel === "SMS"),
      };
    },
  };
}

// Feature 19b: the review reminder, by email only, with a fresh link (its
// hash is stored only if the email is queued). Only when the customer has an
// email and the store's email copies are on.
export function reviewReminderMessages(token: string): MessageRequest {
  return {
    countBookingSms: false,
    createdByUserId: null,
    plan: (context) => {
      const destinations = chooseDestinations({
        customerPhone: context.customer.phone,
        customerEmail: context.customer.email,
        smsEnabled: false,
        emailCopiesEnabled: context.store.emailCopiesEnabled,
        smsWithinCap: false,
      }).filter((destination) => destination.channel === "EMAIL");
      const link = getTrackingUrl(token);
      const messages = destinations.map(
        (destination): NewMessage => ({
          ...destination,
          template: MESSAGE_TEMPLATES.reviewRequest,
          body: renderBody("EMAIL", MESSAGE_TEMPLATES.reviewRequest, context, link),
        }),
      );
      return { messages, newTokenHash: messages.length > 0 ? hashToken(token) : null, capAlert: false };
    },
  };
}

// A stage move's message: Ready or On its way, moving forward only.
export function stageMessages(from: OrderStage, to: OrderStage, actorUserId: string): MessageRequest | null {
  const template = getStageMessageTemplate(from, to);
  return template ? customerMessages({ template, createdByUserId: actorUserId }) : null;
}

// An email's body is its content (composeEmail), laid out when it is sent.
const emailBodySchema = z.object({
  subject: z.string(),
  paragraphs: z.array(z.string()),
  button: z.object({ label: z.string(), url: z.string() }).nullable(),
  smallPrint: z.array(z.string()),
});

// The review reminder is email only, so only the four messages have an SMS.
function renderBody(channel: "SMS", template: CustomerMessageTemplate, context: MessageContext, link: string | null): string;
function renderBody(channel: NewMessage["channel"], template: EmailMessageTemplate, context: MessageContext, link: string | null): string;
function renderBody(
  channel: NewMessage["channel"],
  template: EmailMessageTemplate,
  context: MessageContext,
  link: string | null,
): string {
  const wording = {
    template,
    storeName: context.store.name,
    customerName: context.customer.name,
    orderNumber: formatOrderNumber(context.store, context.order.orderNumber),
    fulfilmentType: context.order.fulfilmentType,
    link,
    linkDomain: getLinkDomain(),
    storePhone: context.store.phone ? formatPhone(context.store.phone) : null,
  };
  if (channel === "EMAIL") return JSON.stringify(composeEmail(wording));
  if (!isCustomerMessageTemplate(template)) throw new Error(`The ${template} message is sent by email only.`);
  return composeMessageText({ ...wording, template });
}

// "fluta.app": where real tracking links point, for the safety line.
function getLinkDomain(): string {
  return new URL(getServerEnv().BETTER_AUTH_URL).host;
}

// ───────────── Sending ─────────────

// Right after the trigger's transaction commits: in a request, once the
// response is on its way (after()), otherwise (scripts, tests) at once. The
// scheduled job retries anything that doesn't go now.
export async function sendAfterCommit(queued: QueuedMessages | null | undefined): Promise<void> {
  if (!queued || (queued.ids.length === 0 && queued.capAlert === null)) return;
  const work = () => deliverQueued(queued);
  try {
    after(work);
  } catch {
    await work();
  }
}

async function deliverQueued(queued: QueuedMessages): Promise<void> {
  for (const id of queued.ids) await sendMessage(queued.storeId, id);
  if (queued.capAlert) await sendCapAlert(queued.capAlert);
}

// NOT_NEEDED: a review reminder the last check stopped (Feature 19b).
export type SendOutcome = "SENT" | "FAILED" | "NOT_CLAIMED" | "NOT_NEEDED";

// Claims the message (using up an attempt), sends it, and records what
// happened. Never throws.
export async function sendMessage(storeId: string, id: string, now: Date = new Date()): Promise<SendOutcome> {
  let message: ClaimedMessage | null;
  try {
    message = await claimMessage(storeId, id, now);
  } catch (error) {
    logger.error(`[messages] claiming message ${id} failed:`, describeError(error));
    return "NOT_CLAIMED";
  }
  if (!message) return "NOT_CLAIMED";

  try {
    if (message.template === MESSAGE_TEMPLATES.reviewRequest && !(await isReminderStillNeeded(message, now))) {
      await markMessageNotNeeded(storeId, id);
      return "NOT_NEEDED";
    }
    const providerMessageId = await deliver(message);
    await markMessageSent(storeId, id, providerMessageId, new Date());
    return "SENT";
  } catch (error) {
    const reason = describeError(error);
    logger.error(`[messages] ${message.channel} message ${id} failed (attempt ${message.attempts}):`, reason);
    try {
      await markMessageFailed(storeId, id, reason, isFinallyFailed({ status: "FAILED", attempts: message.attempts }));
    } catch (markError) {
      logger.error(`[messages] recording message ${id}'s failure failed:`, describeError(markError));
    }
    return "FAILED";
  }
}

// The last check before each attempt at a review reminder, the first or a
// retry: not sent once the customer has reviewed, the order was reopened or
// cancelled, or the review window has ended.
async function isReminderStillNeeded(message: ClaimedMessage, now: Date): Promise<boolean> {
  const order = await findReminderOrder(message.storeId, message.orderId);
  return order !== null && isReviewReminderStillNeeded(order, now);
}

async function deliver(message: ClaimedMessage): Promise<string | null> {
  if (message.channel === "SMS") {
    const { providerMessageId } = await getSmsProvider().send({ to: message.recipient, text: message.body });
    return providerMessageId;
  }
  const email = emailBodySchema.parse(JSON.parse(message.body));
  await getMailer().send({
    to: message.recipient,
    subject: email.subject,
    text: emailText(email),
    html: renderEmailHtml({
      // The sentence after the greeting, for the inbox preview.
      preview: email.paragraphs[1] ?? email.subject,
      heading: message.storeName,
      paragraphs: email.paragraphs,
      button: email.button ?? undefined,
      smallPrint: email.smallPrint,
      footer: `Sent by Fluta on behalf of ${message.storeName}.`,
    }),
  });
  return null;
}

// A short reason for lastError and the log: Termii's status code, Resend's
// error code, or the error's class. Never the body, link, or recipient.
function describeError(error: unknown): string {
  if (error instanceof TermiiError) return `Termii ${error.message}`;
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}

async function sendCapAlert(alert: { storeName: string; cap: number }): Promise<void> {
  const text = `${alert.storeName} has used 80% of its daily limit of ${alert.cap} booking SMS. Once it reaches the limit, new online bookings still go through, but no order link SMS is sent until tomorrow.`;
  await trySendEmail(
    {
      to: getServerEnv().FLUTA_ALERT_EMAIL,
      subject: `${alert.storeName}: 80% of today's booking SMS used`,
      text,
    },
    "booking SMS cap alert",
  );
}

// ───────────── The scheduled job ─────────────

const JOB_BATCH_SIZE = 100;

export interface MessageJobResult {
  sent: number;
  failed: number;
  stuck: number;
  ipHashesCleared: number;
  locationsCleared: number;
}

// Every 5 minutes (/api/cron/messages): ends messages stuck on their last
// attempt, retries every due message once, and clears booking IP hashes
// older than 24 hours.
export async function runMessageJob(now: Date): Promise<MessageJobResult> {
  const stuck = await failStuckMessages(now);
  let sent = 0;
  let failed = 0;
  for (const { storeId, id } of await findDueMessages(now, JOB_BATCH_SIZE)) {
    const outcome = await sendMessage(storeId, id, now);
    if (outcome === "SENT") sent++;
    if (outcome === "FAILED") failed++;
  }
  const ipHashesCleared = await clearOldBookingIpHashes(now);
  const locationsCleared = await clearOldPickupLocations(now);
  return { sent, failed, stuck, ipHashesCleared, locationsCleared };
}

// ───────────── The review reminder (Feature 19b) ─────────────

const REMINDER_BATCH_SIZE = 100;

// Run by the scheduled job before it sends: queues one review reminder for
// each order now due one (isReviewReminderDue), each with a fresh link. The
// job then sends them in the same run. The database allows one reminder per
// order, ever, so a repeated or overlapping run never queues a second.
// Returns how many were queued.
export async function queueReviewReminders(now: Date): Promise<number> {
  let queued = 0;
  for (const order of await findReviewReminderCandidates(now, REMINDER_BATCH_SIZE)) {
    const due = isReviewReminderDue(
      { stage: order.stage, completedAt: order.completedAt, storeStatus: order.store.status, timeZone: order.store.timeZone, hasReview: false },
      now,
    );
    if (!due) continue;
    try {
      const result = await queueMessagesForOrder(order.storeId, order.id, reviewReminderMessages(generateToken()), now);
      queued += result?.ids.length ?? 0;
    } catch (error) {
      // Another run queued it first.
      if (isUniqueViolation(error)) continue;
      logger.error(`[messages] queuing the review reminder for order ${order.id} failed:`, describeError(error));
    }
  }
  return queued;
}

// ───────────── Staff actions on the order page ─────────────

export interface MessageActor {
  storeId: string;
  userId: string;
}

export type MessageActionResult = { ok: true; message: string } | { ok: false; message: string };

export const MESSAGE_ORDER_NOT_FOUND = "Order not found.";
const NO_SMS = "This customer can't get SMS: only Nigerian numbers can, and the store's SMS must be on.";

// "Send link by SMS": a fresh link, by SMS (and an email copy when the
// customer has an email and email copies are on). Never capped.
export async function sendLinkBySms(actor: MessageActor, orderId: string, now: Date): Promise<MessageActionResult> {
  const refusal = await getLinkRefusal(actor.storeId, orderId, now);
  if (refusal) return { ok: false, message: refusal };

  const settings = await findStoreCommunicationSettings(actor.storeId);
  if (!settings?.smsEnabled) return { ok: false, message: NO_SMS };

  const request = customerMessages({
    template: MESSAGE_TEMPLATES.orderLink,
    createdByUserId: actor.userId,
    link: { token: generateToken(), stored: false },
  });
  const queued = await queueMessagesForOrder(actor.storeId, orderId, guardSms(request), now);
  if (!queued) return { ok: false, message: MESSAGE_ORDER_NOT_FOUND };
  if (queued.ids.length === 0) return { ok: false, message: NO_SMS };
  await sendAfterCommit(queued);
  return { ok: true, message: "Link sent by SMS. The old link no longer works." };
}

// Queues nothing at all unless the SMS itself can go, so an email copy
// never goes out alone from "Send link by SMS".
function guardSms(request: MessageRequest): MessageRequest {
  return {
    ...request,
    plan: (context) => {
      const plan = request.plan(context);
      if (plan.messages.some((message) => message.channel === "SMS")) return plan;
      return { messages: [], newTokenHash: null, capAlert: false };
    },
  };
}

// "Send again" on a message that finally failed: a new message by the same
// channel, with a fresh link if it is a link message. Never capped.
export async function resendMessage(
  actor: MessageActor,
  orderId: string,
  messageId: string,
  now: Date,
): Promise<MessageActionResult> {
  const original = await findOrderMessage(actor.storeId, orderId, messageId);
  if (!original) return { ok: false, message: "This message no longer exists. Refresh the page." };
  if (original.channel === "WHATSAPP_MANUAL" || !isFinallyFailed(original)) {
    return { ok: false, message: "Only a message that wasn't sent can be sent again." };
  }
  // The review reminder is sent once only (Feature 19b).
  if (!isCustomerMessageTemplate(original.template)) return { ok: false, message: "This message can't be sent again." };
  const template = original.template;
  const link = isLinkTemplate(template);
  if (link) {
    const refusal = await getLinkRefusal(actor.storeId, orderId, now);
    if (refusal) return { ok: false, message: refusal };
  }

  const queued = await queueMessagesForOrder(
    actor.storeId,
    orderId,
    customerMessages({
      template,
      createdByUserId: actor.userId,
      ...(link && { link: { token: generateToken(), stored: false } }),
      channels: [original.channel],
    }),
    now,
  );
  if (!queued) return { ok: false, message: MESSAGE_ORDER_NOT_FOUND };
  const channel = original.channel === "SMS" ? "SMS" : "email";
  if (queued.ids.length === 0) {
    return {
      ok: false,
      message:
        original.channel === "SMS"
          ? NO_SMS
          : "This customer can't get email: they need an email address, and the store's email copies must be on.",
    };
  }
  await sendAfterCommit(queued);
  return { ok: true, message: `Sending the ${channel} again.` };
}

export type WhatsAppResult = { ok: true; url: string } | { ok: false; message: string };

// "Message on WhatsApp" / "Send link by WhatsApp": a chat on the staff
// member's own phone with a prepared message. Recorded as OPENED only.
export async function openWhatsApp(
  actor: MessageActor,
  orderId: string,
  withLink: boolean,
  now: Date,
): Promise<WhatsAppResult> {
  const settings = await findStoreCommunicationSettings(actor.storeId);
  if (!settings?.whatsappContactEnabled) return { ok: false, message: "WhatsApp is turned off in Settings." };
  if (withLink) {
    const refusal = await getLinkRefusal(actor.storeId, orderId, now);
    if (refusal) return { ok: false, message: refusal };
  }

  const token = withLink ? generateToken() : null;
  const order = await recordWhatsAppOpened(
    actor.storeId,
    orderId,
    {
      template: withLink ? MESSAGE_TEMPLATES.whatsappLink : MESSAGE_TEMPLATES.whatsappMessage,
      newTokenHash: token ? hashToken(token) : null,
      actorUserId: actor.userId,
    },
    now,
  );
  if (!order) return { ok: false, message: MESSAGE_ORDER_NOT_FOUND };
  const text = composeWhatsAppText({
    customerName: order.customerName,
    storeName: order.storeName,
    orderNumber: formatOrderNumber(order, order.orderNumber),
    link: token ? getTrackingUrl(token) : null,
  });
  return { ok: true, url: getWhatsAppUrl(order.customerPhone, text) };
}

// Why a new link can't be sent for this order, or null when it can.
async function getLinkRefusal(storeId: string, orderId: string, now: Date): Promise<string | null> {
  const order = await findLinkOrder(storeId, orderId);
  if (!order) return MESSAGE_ORDER_NOT_FOUND;
  return canIssueTrackingLink(order, now) ? null : LINK_EXPIRED_MESSAGE;
}

// Whether "Send link by SMS" is offered for this customer.
export function canSendSmsTo(phone: string, smsEnabled: boolean): boolean {
  return smsEnabled && isNigerianNumber(phone);
}
