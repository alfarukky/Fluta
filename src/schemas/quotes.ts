import { z } from "zod";

import { REVISION_REASON_MAX } from "@/lib/quotes";

import {
  adjustmentSchema,
  ADDRESS_MAX,
  chargeText,
  MAX_ADJUSTMENT_LINES,
  MAX_SERVICE_LINES,
  orderIdSchema,
  outOfAreaNameSchema,
  quantityText,
  recordId,
  unitPriceText,
} from "./orders";

// Quotes and revisions. The browser sends IDs, quantities, Others lines, the
// area choice, and unit prices for quote-required lines; every total is built
// on the server, which also decides which lines may take a price.

export const DECISION_NOTE_MAX = 300;
export const CUSTOMER_MESSAGE_MAX = 500;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .nullish()
    .transform((value) => value || null);

const requiredText = (max: number, label: string, missing: string) =>
  z.string().trim().min(1, missing).max(max, `${label} must be ${max} characters or fewer`);

// unitPrice: only for a quote-required line (the server refuses it on any
// other); missing or blank keeps the line's price.
const revisionLineSchema = z.discriminatedUnion("kind", [
  // A line already on the order keeps the unit price it was added at, unless priced here.
  z.object({ kind: z.literal("existing"), lineId: recordId, quantity: quantityText, unitPrice: unitPriceText.optional() }),
  // A new line starts at today's catalogue price.
  z.object({ kind: z.literal("new"), serviceId: recordId, quantity: quantityText, unitPrice: unitPriceText.optional() }),
]);

export const issueRevisionSchema = z.object({
  orderId: orderIdSchema,
  // The newest version the editor was opened on: if another revision was
  // issued since, nothing is saved.
  basedOnVersion: z.number().int().min(1).max(10_000),
  lines: z.array(revisionLineSchema).max(MAX_SERVICE_LINES, `An order can have up to ${MAX_SERVICE_LINES} services`),
  adjustments: z.array(adjustmentSchema).max(MAX_ADJUSTMENT_LINES, `Add up to ${MAX_ADJUSTMENT_LINES} Others lines`),
  // Pickup orders only; ignored on a drop-off order.
  area: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("current") }),
      z.object({ kind: z.literal("area"), areaId: recordId }),
      z.object({ kind: z.literal("outOfArea"), name: outOfAreaNameSchema }),
    ])
    .default({ kind: "current" }),
  charge: chargeText.default(null),
  // Shown to the customer. Required after the first approved quote (checked
  // on the server, which knows whether there is one).
  reason: optionalText(REVISION_REASON_MAX, "Reason"),
});

export type IssueRevisionRequest = z.input<typeof issueRevisionSchema>;
export type IssueRevisionInput = z.output<typeof issueRevisionSchema>;

// Staff record a decision the customer gave in person or by phone.
export const recordDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("APPROVE"),
    orderId: orderIdSchema,
    revisionId: recordId,
    // How it was received, e.g. "Approved by phone, 2:15 PM".
    note: requiredText(DECISION_NOTE_MAX, "Note", "Add a note on how the customer approved"),
  }),
  z.object({
    decision: z.literal("DECLINE"),
    orderId: orderIdSchema,
    revisionId: recordId,
    // What the customer said, in their words.
    customerMessage: requiredText(CUSTOMER_MESSAGE_MAX, "Reason", "Enter the customer's reason"),
    note: optionalText(DECISION_NOTE_MAX, "Note"),
  }),
]);

export type RecordDecisionInput = z.output<typeof recordDecisionSchema>;

export const editAddressSchema = z.object({
  orderId: orderIdSchema,
  address: requiredText(ADDRESS_MAX, "Address", "Enter the pickup and delivery address"),
});

export type EditAddressInput = z.output<typeof editAddressSchema>;
