import { z } from "zod";

import { FulfilmentType } from "@/generated/prisma/enums";
import { normalizeEmail } from "@/lib/email-address";
import { formatNaira, parseNairaToKobo } from "@/lib/money";
import { STAFF_CHANNELS } from "@/lib/orders";
import { normalizePhone } from "@/lib/phone";
import { parseClockTime } from "@/lib/pickup-schedule";
import { parseHundredths } from "@/lib/quantity";
import { parseDateKey } from "@/lib/time";

import { AREA_NAME_MAX, MAX_AREA_CHARGE } from "./fulfilment";

export const CUSTOMER_NAME_MAX = 80;
export const ADDRESS_MAX = 200;
export const INTERNAL_NOTE_MAX = 500;
export const ADJUSTMENT_DESCRIPTION_MAX = 100;
export const MAX_ADJUSTMENT = 100_000_000; // ₦1,000,000 in kobo
export const MAX_SERVICE_LINES = 50;
export const MAX_ADJUSTMENT_LINES = 20;

// Customer phone numbers without a country code are Nigerian.
export const CUSTOMER_PHONE_COUNTRY = "NG";

export const STORE_NOT_ACCEPTING_MESSAGE =
  "Your store can't take new orders right now. Contact Fluta support for help.";

export const ADJUSTMENT_KIND_LABELS = { CHARGE: "Extra charge", DISCOUNT: "Discount" } as const;
export type AdjustmentKind = keyof typeof ADJUSTMENT_KIND_LABELS;

const recordId = z.string().trim().min(1).max(64);

// A customer's phone number in E.164.
export const customerPhoneSchema = z
  .string()
  .trim()
  .max(40, "Enter a valid phone number")
  .transform((value, ctx) => {
    const e164 = value ? normalizePhone(value, CUSTOMER_PHONE_COUNTRY) : null;
    if (!e164) {
      ctx.addIssue({ code: "custom", message: value ? "Enter a valid phone number" : "Enter the customer's phone number" });
      return z.NEVER;
    }
    return e164;
  });

const customerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), customerId: recordId }),
  z.object({
    kind: z.literal("new"),
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(CUSTOMER_NAME_MAX, `Name must be ${CUSTOMER_NAME_MAX} characters or fewer`),
    phone: customerPhoneSchema,
    // Optional: blank is saved as no email.
    email: z
      .string()
      .max(254, "Enter a valid email address")
      .transform((value) => normalizeEmail(value) || null)
      .pipe(z.email("Enter a valid email address").nullable()),
  }),
]);

// Up to two decimal places, as hundredths ("2.5" → 250). Blank is null. The
// server checks the range for the service's pricing type (getQuantityProblem).
const quantityText = z
  .string()
  .max(12, "Enter a number")
  .transform((value, ctx) => {
    const text = value.trim();
    if (!text) return null;
    const hundredths = parseHundredths(text);
    if (hundredths === null) {
      ctx.addIssue({ code: "custom", message: "Enter a number, like 3 or 2.5" });
      return z.NEVER;
    }
    return hundredths;
  });

// Only the service and how much: the price always comes from the catalogue.
const serviceLineSchema = z.object({
  serviceId: recordId,
  quantity: quantityText,
  estimate: quantityText,
});

const AMOUNT_FORMAT_MESSAGE = "Enter an amount in Naira, like 500 or 1,500.50";

function nairaAmount(max: number, maxLabel: string) {
  return z
    .string()
    .max(40, AMOUNT_FORMAT_MESSAGE)
    .transform((value, ctx) => {
      const kobo = parseNairaToKobo(value);
      if (kobo === null) {
        ctx.addIssue({ code: "custom", message: AMOUNT_FORMAT_MESSAGE });
        return z.NEVER;
      }
      if (kobo > max) {
        ctx.addIssue({ code: "custom", message: `${maxLabel} must be ${formatNaira(max)} or less` });
        return z.NEVER;
      }
      return kobo;
    });
}

// "Others": a description and a positive amount; a discount is stored negative.
const adjustmentSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Describe this charge or discount")
      .max(ADJUSTMENT_DESCRIPTION_MAX, `Description must be ${ADJUSTMENT_DESCRIPTION_MAX} characters or fewer`),
    kind: z.enum(["CHARGE", "DISCOUNT"], "Choose Extra charge or Discount"),
    amount: nairaAmount(MAX_ADJUSTMENT, "Amount").refine((kobo) => kobo > 0, "Enter an amount above ₦0"),
  })
  .transform(({ description, kind, amount }) => ({
    description,
    amount: kind === "DISCOUNT" ? -amount : amount,
  }));

const clockTime = z.string().refine((value) => parseClockTime(value) !== null, "Choose a time");

const pickupSchema = z.object({
  area: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("area"), areaId: recordId }),
    // Outside the store's service areas: the name is kept on the order only.
    z.object({
      kind: z.literal("outOfArea"),
      name: z
        .string()
        .trim()
        .min(2, "Area name must be at least 2 characters")
        .max(AREA_NAME_MAX, `Area name must be ${AREA_NAME_MAX} characters or fewer`),
    }),
  ]),
  address: z
    .string()
    .trim()
    .min(1, "Enter the pickup and delivery address")
    .max(ADDRESS_MAX, `Address must be ${ADDRESS_MAX} characters or fewer`),
  date: z.string().refine((value) => parseDateKey(value) !== null, "Choose a pickup date"),
  outsideSchedule: z.boolean(),
  windowStart: clockTime,
  windowEnd: clockTime,
  // Staff enter the agreed charge only for a quote-required area or an
  // out-of-area order (₦0 allowed); a fixed area's charge comes from the area.
  charge: z
    .string()
    .max(40, AMOUNT_FORMAT_MESSAGE)
    .transform((value) => value.trim())
    .pipe(z.union([z.literal("").transform(() => null), nairaAmount(MAX_AREA_CHARGE, "Charge")])),
});

export const createOrderSchema = z
  .object({
    // Generated once when the form opens (crypto.randomUUID()); creating
    // twice with the same ID returns the same order.
    clientRequestId: z.uuid("This form has expired. Reload the page and try again."),
    customer: customerSchema,
    channel: z.enum(STAFF_CHANNELS, "Choose how the order came in"),
    fulfilmentType: z.enum(FulfilmentType, "Choose drop-off or pickup & delivery"),
    pickup: pickupSchema.nullable(),
    serviceLines: z
      .array(serviceLineSchema)
      .min(1, "Add at least one service")
      .max(MAX_SERVICE_LINES, `An order can have up to ${MAX_SERVICE_LINES} services`),
    adjustments: z.array(adjustmentSchema).max(MAX_ADJUSTMENT_LINES, `Add up to ${MAX_ADJUSTMENT_LINES} Others lines`),
    internalNote: z
      .string()
      .trim()
      .max(INTERNAL_NOTE_MAX, `Note must be ${INTERNAL_NOTE_MAX} characters or fewer`)
      .transform((value) => value || null),
  })
  .superRefine((order, ctx) => {
    const pickup = order.fulfilmentType === FulfilmentType.PICKUP_DELIVERY;
    if (pickup && !order.pickup) {
      ctx.addIssue({ code: "custom", path: ["pickup"], message: "Enter the pickup details" });
    }
    if (pickup && order.pickup?.area.kind === "outOfArea" && order.pickup.charge === null) {
      ctx.addIssue({ code: "custom", path: ["pickup", "charge"], message: "Enter the agreed charge, or 0" });
    }
    if (pickup && order.pickup?.outsideSchedule && !order.internalNote) {
      ctx.addIssue({
        code: "custom",
        path: ["internalNote"],
        message: "Add a note explaining the pickup outside the normal schedule",
      });
    }
  })
  // A drop-off order has no address or schedule, whatever was sent.
  .transform((order) => (order.fulfilmentType === FulfilmentType.DROP_OFF ? { ...order, pickup: null } : order));

// What the form sends (all text as typed).
export type CreateOrderRequest = z.input<typeof createOrderSchema>;
export type CreateOrderInput = z.output<typeof createOrderSchema>;
export type PickupInput = NonNullable<CreateOrderInput["pickup"]>;

export const customerSearchSchema = z.string().trim().min(2).max(80);

// An order ID from the URL. It is only ever looked up within the member's own store.
export const orderIdSchema = z.string().trim().min(1).max(64);
