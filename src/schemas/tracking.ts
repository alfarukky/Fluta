import { z } from "zod";

import { orderIdSchema, recordId } from "./orders";

// The customer's actions on their tracking page. The token itself is checked
// on the server (isWellFormedToken, then its hash), never trusted from here.

export const CUSTOMER_MESSAGE_MAX = 300;

export const trackingTokenSchema = z.string().min(1).max(64);

export const priceDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVE"), revisionId: recordId }),
  z.object({
    decision: z.literal("DECLINE"),
    revisionId: recordId,
    // "Decline or ask a question": an optional message to the store.
    message: z
      .string()
      .trim()
      .max(CUSTOMER_MESSAGE_MAX, `Your message must be ${CUSTOMER_MESSAGE_MAX} characters or fewer`)
      .nullish()
      .transform((value) => value || null),
  }),
]);

export type PriceDecisionRequest = z.input<typeof priceDecisionSchema>;

export const acceptPickupSchema = z.object({ suggestionId: recordId });

// Staff "Get tracking link".
export const issueTrackingLinkSchema = z.object({ orderId: orderIdSchema });
