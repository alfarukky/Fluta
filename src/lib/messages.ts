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
} as const;

export type MessageTemplate = (typeof MESSAGE_TEMPLATES)[keyof typeof MESSAGE_TEMPLATES];

// The four automatic messages, sent by SMS and email.
export type CustomerMessageTemplate = Extract<MessageTemplate, "LINK_CREATED" | "QUOTE_NEEDS_APPROVAL" | "READY" | "OUT_FOR_DELIVERY">;

// Messages that carry a tracking link (and ask the customer to act).
export const LINK_TEMPLATES: readonly CustomerMessageTemplate[] = [MESSAGE_TEMPLATES.orderLink, MESSAGE_TEMPLATES.priceUpdate];

export function isLinkTemplate(template: string): boolean {
  return (LINK_TEMPLATES as readonly string[]).includes(template);
}

const TEMPLATE_LABELS: Record<MessageTemplate, string> = {
  LINK_CREATED: "Order link",
  QUOTE_NEEDS_APPROVAL: "Price update",
  READY: "Ready",
  OUT_FOR_DELIVERY: "On its way",
  WHATSAPP_LINK: "Link by WhatsApp",
  WHATSAPP_MESSAGE: "WhatsApp message",
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
      return { label: "Replaced by a newer message", tone: "neutral" };
  }
}
