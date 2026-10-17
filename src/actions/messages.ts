"use server";

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/logger";
import { openWhatsAppSchema, orderMessageSchema, resendMessageSchema } from "@/schemas/messages";
import { requireStoreMember } from "@/server/auth/session";
import {
  MESSAGE_ORDER_NOT_FOUND,
  openWhatsApp as open,
  resendMessage as resend,
  sendLinkBySms as sendLink,
  type MessageActionResult,
  type WhatsAppResult,
} from "@/server/services/notifications";

// Staff message actions on the order detail page: "Send link by SMS", "Send
// again", and the two WhatsApp buttons. Owners and staff may, whenever the
// store can work on existing orders. The store and user come from the
// membership.

const NOT_ALLOWED = "You can't change this store's orders.";
const STORE_PAUSED = "This store can't work on orders right now.";
const FAILED = "Something went wrong. Please try again.";

type Member = Extract<Awaited<ReturnType<typeof requireStoreMember>>, { allowed: true }>;

async function requireOrderWorker(): Promise<{ member: Member } | { refusal: string }> {
  const member = await requireStoreMember();
  if (!member.allowed) return { refusal: NOT_ALLOWED };
  if (!member.access.canWorkOnExistingOrders) return { refusal: STORE_PAUSED };
  return { member };
}

export async function sendLinkBySms(request: unknown): Promise<MessageActionResult> {
  const check = await requireOrderWorker();
  if ("refusal" in check) return { ok: false, message: check.refusal };
  const parsed = orderMessageSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: MESSAGE_ORDER_NOT_FOUND };

  const { store, user } = check.member;
  try {
    const result = await sendLink({ storeId: store.id, userId: user.id }, parsed.data.orderId, new Date());
    if (result.ok) revalidatePath("/orders", "layout");
    return result;
  } catch (error) {
    logger.error(`[messages] sending a link by SMS for store ${store.id} failed:`, describeError(error));
    return { ok: false, message: FAILED };
  }
}

export async function resendMessage(request: unknown): Promise<MessageActionResult> {
  const check = await requireOrderWorker();
  if ("refusal" in check) return { ok: false, message: check.refusal };
  const parsed = resendMessageSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: MESSAGE_ORDER_NOT_FOUND };

  const { store, user } = check.member;
  try {
    const result = await resend(
      { storeId: store.id, userId: user.id },
      parsed.data.orderId,
      parsed.data.messageId,
      new Date(),
    );
    if (result.ok) revalidatePath("/orders", "layout");
    return result;
  } catch (error) {
    logger.error(`[messages] sending a message again for store ${store.id} failed:`, describeError(error));
    return { ok: false, message: FAILED };
  }
}

// Returns the wa.me link for the browser to open. Recorded as opened only.
export async function openWhatsApp(request: unknown): Promise<WhatsAppResult> {
  const check = await requireOrderWorker();
  if ("refusal" in check) return { ok: false, message: check.refusal };
  const parsed = openWhatsAppSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: MESSAGE_ORDER_NOT_FOUND };

  const { store, user } = check.member;
  try {
    const result = await open({ storeId: store.id, userId: user.id }, parsed.data.orderId, parsed.data.withLink, new Date());
    if (result.ok) revalidatePath("/orders", "layout");
    return result;
  } catch (error) {
    logger.error(`[messages] opening WhatsApp for store ${store.id} failed:`, describeError(error));
    return { ok: false, message: FAILED };
  }
}

// The error's class and Prisma code only, never the message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
