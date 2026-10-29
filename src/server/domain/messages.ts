import "server-only";

import type { FulfilmentType, MessageStatus, OrderStage } from "@/generated/prisma/enums";
import { MAX_MESSAGE_ATTEMPTS, MESSAGE_TEMPLATES, type CustomerMessageTemplate } from "@/lib/messages";
import { isNigerianNumber } from "@/lib/phone";
import { getLocalDateKey, startOfLocalDay } from "@/lib/time";

// The rules for customer messages: their wording, which channels they go
// by, the daily cap on booking SMS, and when a message may be claimed for
// sending. Pure: no database, network, or clock.

// ───────────── Wording ─────────────

// Characters every SMS part can carry in the standard (GSM-7) alphabet, minus
// the semicolon (Fluta's writing never uses one). Anything else would turn
// the whole message into the costlier Unicode encoding.
const PLAIN_CHARACTER = /[A-Za-z0-9 .,:!?'"()&@#%+\-/=*_<>$\n]/;
const REPLACEMENTS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "₦": "NGN ",
  ";": ",",
};

// Store-typed text made plain: curly quotes straightened, ₦ written as NGN,
// semicolons as commas, anything else outside the plain alphabet (emoji,
// accents) dropped, and spaces collapsed.
export function toPlainText(text: string): string {
  return [...text.normalize("NFKD")]
    .map((character) => REPLACEMENTS[character] ?? (PLAIN_CHARACTER.test(character) ? character : ""))
    .join("")
    .replace(/[ \n]+/g, " ")
    .trim();
}

export function isPlainText(text: string): boolean {
  return [...text].every((character) => PLAIN_CHARACTER.test(character));
}

export interface MessageWording {
  template: CustomerMessageTemplate;
  storeName: string;
  // The customer's name as entered; only the first name is used.
  customerName: string;
  // formatOrderNumber, e.g. "FF-1024".
  orderNumber: string;
  fulfilmentType: FulfilmentType;
  // The tracking link (getTrackingUrl), for the two link messages only.
  link: string | null;
  // The app's domain, e.g. "fluta.app", for the safety line.
  linkDomain: string;
  // The store's phone as customers dial it.
  storePhone: string | null;
}

// Titles people type before a name: "Hi Mrs" would read oddly, so the
// greeting falls back to "Hi there".
const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "chief", "alhaji", "alhaja", "madam", "sir", "engr", "pastor"]);

// The first name to greet the customer by, or null for "Hi there": the
// first word, when it is a plausible name (two or more letters, not a title).
export function getGreetingName(customerName: string): string | null {
  const first = customerName.trim().split(/\s+/)[0]?.replace(/[.,]+$/, "") ?? "";
  if (!/^\p{L}[\p{L}'-]+$/u.test(first) || TITLES.has(first.toLowerCase())) return null;
  return first;
}

function greeting(name: string | null): string {
  return name ? `Hi ${name}` : "Hi there";
}

// The SMS: the store's name first, a greeting, what happened, and either
// the link with a safety line or the store's phone. Plain characters only
// (no emoji), so each part is a standard SMS.
export function composeMessageText(input: MessageWording): string {
  const store = toPlainText(input.storeName) || "Your laundry store";
  const order = toPlainText(input.orderNumber);
  const domain = toPlainText(input.linkDomain);
  // Accents become plain letters ("Zoë" → "Zoe"), so the name never turns
  // the SMS into Unicode.
  const name = toPlainText(getGreetingName(input.customerName) ?? "");
  const hi = greeting(name.length >= 2 ? name : null);

  const withLink = (sentence: string, closing: string) => {
    if (input.link === null) throw new Error(`The ${input.template} message needs a link.`);
    return `${store}: ${hi}, ${sentence} ${input.link} ${closing} Real links start with ${domain}`;
  };
  const withPhone = (sentence: string, closing: string) => {
    const phone = input.storePhone ? toPlainText(input.storePhone) : "";
    return `${store}: ${hi}, ${sentence} ${closing}${phone ? ` Questions? Call ${phone}` : ""}`;
  };

  switch (input.template) {
    case MESSAGE_TEMPLATES.orderLink:
      return withLink(`we've received your order ${order}. Track it here:`, `Thank you for choosing ${store}.`);
    case MESSAGE_TEMPLATES.priceUpdate:
      return withLink(
        `there's an update to the price of your order ${order} that needs your approval. Please review it here:`,
        "Thank you.",
      );
    case MESSAGE_TEMPLATES.ready:
      return withPhone(
        input.fulfilmentType === "PICKUP_DELIVERY"
          ? `your order ${order} is ready and will be delivered to you soon.`
          : `your order ${order} is ready for collection.`,
        "Thank you!",
      );
    case MESSAGE_TEMPLATES.onItsWay:
      return withPhone(`your order ${order} is on its way to you.`, "See you soon!");
  }
}

// Standard SMS parts the text takes: 160 characters alone, 153 each when
// split (the rest carries the joining header).
export function countSmsParts(text: string): number {
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

export interface EmailContent {
  // The store's name first.
  subject: string;
  // Greeting, what happened, and the thank-you, one paragraph each.
  paragraphs: string[];
  button: { label: string; url: string } | null;
  // The safety line for links, and the store's phone.
  smallPrint: string[];
}

// The email copy: warmer and roomier than the SMS, with the same facts. Any
// characters are fine here (the layout escapes them), but no emoji.
export function composeEmail(input: MessageWording): EmailContent {
  const { storeName: store, orderNumber: order } = input;
  const hi = `${greeting(getGreetingName(input.customerName))},`;
  const thanks = `Thank you for choosing ${store}.`;
  const call = input.storePhone ? `If you have any questions, call ${store} on ${input.storePhone}.` : null;
  const safety = `Real links from ${store} always start with ${input.linkDomain}.`;
  const link = (label: string) => {
    if (input.link === null) throw new Error(`The ${input.template} email needs a link.`);
    return { label, url: input.link };
  };
  const smallPrint = (...lines: (string | null)[]) => lines.filter((line): line is string => line !== null);

  switch (input.template) {
    case MESSAGE_TEMPLATES.orderLink:
      return {
        subject: `${store}: we've received your order ${order}`,
        paragraphs: [
          hi,
          `We've received your order ${order}. You can follow its progress at any time with the button below.`,
          `${thanks} We look forward to taking care of your laundry.`,
        ],
        button: link("Track your order"),
        smallPrint: smallPrint(safety, call),
      };
    case MESSAGE_TEMPLATES.priceUpdate:
      return {
        subject: `${store}: please review the price of order ${order}`,
        paragraphs: [
          hi,
          `There's an update to the price of your order ${order} that needs your approval. Please review it with the button below.`,
          thanks,
        ],
        button: link("Review the price"),
        smallPrint: smallPrint(safety, call),
      };
    case MESSAGE_TEMPLATES.ready:
      return {
        subject: `${store}: your order ${order} is ready`,
        paragraphs: [
          hi,
          input.fulfilmentType === "PICKUP_DELIVERY"
            ? `Good news: your order ${order} is ready and will be delivered to you soon.`
            : `Good news: your order ${order} is ready for collection.`,
          thanks,
        ],
        button: null,
        smallPrint: smallPrint(call),
      };
    case MESSAGE_TEMPLATES.onItsWay:
      return {
        subject: `${store}: your order ${order} is on its way`,
        paragraphs: [hi, `Your order ${order} is on its way to you.`, `${thanks} See you soon!`],
        button: null,
        smallPrint: smallPrint(call),
      };
  }
}

// The email's plain-text part: the same words as the HTML, with the link
// written out.
export function emailText(content: EmailContent): string {
  return [
    ...content.paragraphs,
    ...(content.button ? [`${content.button.label}: ${content.button.url}`] : []),
    ...content.smallPrint,
  ].join("\n\n");
}

// ───────────── Stage messages ─────────────

// Moving forward into Ready or Out for delivery tells the customer. Stepping
// back into them (an undo) sends nothing.
export function getStageMessageTemplate(from: OrderStage, to: OrderStage): CustomerMessageTemplate | null {
  if (to === "READY" && from !== "OUT_FOR_DELIVERY" && from !== "COMPLETED") return MESSAGE_TEMPLATES.ready;
  if (to === "OUT_FOR_DELIVERY" && from !== "COMPLETED") return MESSAGE_TEMPLATES.onItsWay;
  return null;
}

// ───────────── Channels ─────────────

export interface ChannelInput {
  customerPhone: string; // E.164
  customerEmail: string | null; // normalized
  smsEnabled: boolean;
  emailCopiesEnabled: boolean;
  // False when the daily booking SMS cap stops this SMS.
  smsWithinCap: boolean;
  // Book and pay's order-link message only (plan 3.2): checkout skips the
  // confirmation screen, so the link is emailed even with email copies off.
  alwaysEmail?: boolean;
}

export type MessageDestination = { channel: "SMS" | "EMAIL"; recipient: string };

// SMS and email are decided independently: SMS to a Nigerian number when the
// store's SMS is on (and within the cap), email to any customer email when
// email copies are on (or, for Book and pay's order link, always).
export function chooseDestinations(input: ChannelInput): MessageDestination[] {
  const destinations: MessageDestination[] = [];
  if (input.smsEnabled && input.smsWithinCap && isNigerianNumber(input.customerPhone)) {
    destinations.push({ channel: "SMS", recipient: input.customerPhone });
  }
  if ((input.emailCopiesEnabled || input.alwaysEmail) && input.customerEmail) {
    destinations.push({ channel: "EMAIL", recipient: input.customerEmail });
  }
  return destinations;
}

// ───────────── The daily booking SMS cap ─────────────

export const CAP_ALERT_SHARE = 0.8;

// The cap's day runs from midnight to midnight in the store's time zone: the
// instant today started there.
export function getCapDayStart(now: Date, timeZone: string): Date {
  return startOfLocalDay(getLocalDateKey(now, timeZone), timeZone);
}

// `sentToday`: order-link SMS from online bookings this store has queued
// since midnight in its time zone. The next one is allowed below the cap,
// and the one that reaches 80% of it sends Fluta's alert (once a day, as
// the count passes that point only once).
export function getBookingSmsCapDecision(sentToday: number, cap: number): { allowed: boolean; alert: boolean } {
  const allowed = sentToday < cap;
  const alertAt = Math.max(1, Math.ceil(cap * CAP_ALERT_SHARE));
  return { allowed, alert: allowed && sentToday + 1 === alertAt };
}

// ───────────── Claiming ─────────────

// A message left in SENDING this long after its last claim (the server
// stopped mid-send, say) may be claimed again, using its next attempt.
export const STUCK_SENDING_MS = 10 * 60 * 1000;

export interface ClaimableMessage {
  status: MessageStatus;
  attempts: number;
  lastAttemptAt: Date | null;
}

// Whether a sender may claim the message now. src/server/data/messages.ts
// writes the same rule as one conditional update.
export function isClaimable(message: ClaimableMessage, now: Date): boolean {
  if (message.attempts >= MAX_MESSAGE_ATTEMPTS) return false;
  if (message.status === "QUEUED" || message.status === "FAILED") return true;
  return message.status === "SENDING" && isStuckSending(message, now);
}

export function isStuckSending(message: ClaimableMessage, now: Date): boolean {
  return (
    message.status === "SENDING" &&
    (message.lastAttemptAt === null || now.getTime() - message.lastAttemptAt.getTime() > STUCK_SENDING_MS)
  );
}

// ───────────── Manual WhatsApp ─────────────

export function composeWhatsAppText(input: { customerName: string; storeName: string; orderNumber: string; link: string | null }): string {
  const greeting = `Hello ${input.customerName}, this is ${input.storeName} about your order ${input.orderNumber}.`;
  return input.link ? `${greeting} You can follow your order here: ${input.link}` : greeting;
}

// Opens a chat with the customer on the staff member's phone, with the text
// ready to edit. Works for any country's number.
export function getWhatsAppUrl(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
