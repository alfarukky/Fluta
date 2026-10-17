import { z } from "zod";

import { orderIdSchema, recordId } from "./orders";

// Staff message actions on the order detail page. The store always comes
// from the caller's membership; these IDs are only used within it.

export const orderMessageSchema = z.object({ orderId: orderIdSchema });

export const resendMessageSchema = z.object({ orderId: orderIdSchema, messageId: recordId });

export const openWhatsAppSchema = z.object({ orderId: orderIdSchema, withLink: z.boolean() });
