import type { MessageChannel, MessageStatus } from "@/generated/prisma/enums";

// Customer messages (MessageEvent.template), and how staff see each one on
// the order page. Shared by the server and the order detail page.

export const MESSAGE_TEMPLATES = {
  orderLink: "LINK_CREATED",
  priceUpdate: "QUOTE_NEEDS_APPROVAL",
  ready: "READY",
  onItsWay: "OUT_FOR_DELIVERY",
  // Manual WhatsApp, recorded as opened only.
  whatsappLink: "WHATSAPP_LINK",
  whatsappMessage: "WHATSAPP_MESSAGE",
  // Feature 19b: the one review reminder, by email only, never sent again.
  reviewRequest: "REVIEW_REQUEST",
} as const;

export type MessageTemplate = (typeof MESSAGE_TEMPLATES)[keyof typeof MESSAGE_TEMPLATES];

// The four automatic messages, sent by SMS and email.
export type CustomerMessageTemplate = Extract<MessageTemplate, "LINK_CREATED" | "QUOTE_NEEDS_APPROVAL" | "READY" | "OUT_FOR_DELIVERY">;

const CUSTOMER_MESSAGE_TEMPLATES: readonly string[] = [
  MESSAGE_TEMPLATES.orderLink,
  MESSAGE_TEMPLATES.priceUpdate,
  MESSAGE_TEMPLATES.ready,
  MESSAGE_TEMPLATES.onItsWay,
];

// One of the four automatic messages (the only ones staff can Send again).
export function isCustomerMessageTemplate(template: string): template is CustomerMessageTemplate {
  return CUSTOMER_MESSAGE_TEMPLATES.includes(template);
}

// The review reminder: an email only.
export type ReviewMessageTemplate = typeof MESSAGE_TEMPLATES.reviewRequest;
export type EmailMessageTemplate = CustomerMessageTemplate | ReviewMessageTemplate;

// Messages that carry a tracking link (and ask the customer to act).
export const LINK_TEMPLATES: readonly CustomerMessageTemplate[] = [MESSAGE_TEMPLATES.orderLink, MESSAGE_TEMPLATES.priceUpdate];

export function isLinkTemplate(template: string): boolean {
  return (LINK_TEMPLATES as readonly string[]).includes(template);
}

// Every message whose body holds a tracking link: the two link messages and
// the review reminder. A newer link replaces the unsent ones.
export const LINK_MESSAGE_TEMPLATES: readonly string[] = [...LINK_TEMPLATES, MESSAGE_TEMPLATES.reviewRequest];

const TEMPLATE_LABELS: Record<MessageTemplate, string> = {
  LINK_CREATED: "Order link",
  QUOTE_NEEDS_APPROVAL: "Price update",
  READY: "Ready",
  OUT_FOR_DELIVERY: "On its way",
  WHATSAPP_LINK: "Link by WhatsApp",
  WHATSAPP_MESSAGE: "WhatsApp message",
  REVIEW_REQUEST: "Review request",
};

export function getMessageTemplateLabel(template: string): string {
  return TEMPLATE_LABELS[template as MessageTemplate] ?? "Message";
}

export const MESSAGE_CHANNEL_LABELS: Record<MessageChannel, string> = {
  SMS: "SMS",
  EMAIL: "Email",
  WHATSAPP_MANUAL: "WhatsApp",
};

// Each message gets at most this many tries.
export const MAX_MESSAGE_ATTEMPTS = 3;

export interface MessageState {
  channel: MessageChannel;
  status: MessageStatus;
  attempts: number;
  // Only to tell a review reminder that was no longer needed apart.
  template?: string;
}

// Out of tries: shown as "SMS not sent" / "Email not sent" with Send again.
export function isFinallyFailed(message: Pick<MessageState, "status" | "attempts">): boolean {
  return message.status === "FAILED" && message.attempts >= MAX_MESSAGE_ATTEMPTS;
}

export type MessageStatusTone = "neutral" | "success" | "warning" | "error" | "info";

// What staff see for a message, in words that follow its channel. SENT means
// the provider accepted it, never that it was delivered.
export function describeMessageStatus(message: MessageState): { label: string; tone: MessageStatusTone } {
  const channel = MESSAGE_CHANNEL_LABELS[message.channel];
  switch (message.status) {
    case "QUEUED":
      return { label: "Waiting to send", tone: "neutral" };
    case "SENDING":
      return { label: "Sending", tone: "neutral" };
    case "SENT":
      return { label: `${channel} sent`, tone: "success" };
    case "FAILED":
      return isFinallyFailed(message)
        ? { label: `${channel} not sent`, tone: "error" }
        : { label: "Trying again soon", tone: "warning" };
    case "OPENED":
      return { label: "WhatsApp opened", tone: "info" };
    case "REPLACED":
      // A review reminder ends REPLACED when it is no longer needed: the
      // customer reviewed, the order was reopened or cancelled, the window
      // ended, or a newer link was sent.
      return message.template === MESSAGE_TEMPLATES.reviewRequest
        ? { label: "No longer needed", tone: "neutral" }
        : { label: "Replaced by a newer message", tone: "neutral" };
  }
}
