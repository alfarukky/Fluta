import { z } from "zod";

import { FulfilmentType } from "@/generated/prisma/enums";
import { normalizeEmail } from "@/lib/email-address";
import { normalizePhone } from "@/lib/phone";
import { parseClockTime } from "@/lib/pickup-schedule";
import { parseDateKey } from "@/lib/time";

import { ADDRESS_MAX, CUSTOMER_NAME_MAX } from "./field-limits";
import {
  CUSTOMER_PHONE_COUNTRY,
  MAX_SERVICE_LINES,
  quantityText,
  recordId,
} from "./orders";

// A customer's booking from the store's booking page. The browser sends only
// IDs, amounts, the choices, and contact details: anything else (a price, a
// charge, a staff field) is dropped here, and the server builds every price.

export const BOOKING_EXPIRED_MESSAGE = "This page has expired. Reload it and try again.";

const serviceLineSchema = z.object({
  serviceId: recordId,
  // How many items or packages, or the estimated weight in kg (optional).
  // Whether it is billed or an estimate depends on the service.
  amount: quantityText,
});

const clockTime = z.string().refine((value) => parseClockTime(value) !== null, "Choose a pickup time");

const pickupSchema = z.object({
  areaId: recordId,
  address: z
    .string()
    .trim()
    .min(1, "Enter your address")
    .max(ADDRESS_MAX, `Address must be ${ADDRESS_MAX} characters or fewer`),
  date: z.string().refine((value) => parseDateKey(value) !== null, "Choose a pickup date"),
  windowStart: clockTime,
  windowEnd: clockTime,
});

const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name")
    .min(2, "Name must be at least 2 characters")
    .max(CUSTOMER_NAME_MAX, `Name must be ${CUSTOMER_NAME_MAX} characters or fewer`),
  phone: z
    .string()
    .trim()
    .max(40, "Enter a valid phone number")
    .transform((value, ctx) => {
      const e164 = value ? normalizePhone(value, CUSTOMER_PHONE_COUNTRY) : null;
      if (!e164) {
        ctx.addIssue({ code: "custom", message: value ? "Enter a valid phone number" : "Enter your phone number" });
        return z.NEVER;
      }
      return e164;
    }),
  // Optional: blank is saved as no email.
  email: z
    .string()
    .max(254, "Enter a valid email address")
    .transform((value) => normalizeEmail(value) || null)
    .pipe(z.email("Enter a valid email address").nullable()),
});

export const bookingRequestSchema = z
  .object({
    // Generated once when the page opens (crypto.randomUUID()); sending the
    // same booking again returns the same order.
    clientRequestId: z.uuid(BOOKING_EXPIRED_MESSAGE),
    serviceLines: z
      .array(serviceLineSchema)
      .min(1, "Choose at least one service")
      .max(MAX_SERVICE_LINES, `Choose up to ${MAX_SERVICE_LINES} services`)
      .refine((lines) => new Set(lines.map((line) => line.serviceId)).size === lines.length, "Choose each service once"),
    fulfilmentType: z.enum(FulfilmentType, "Choose how you'll get your laundry to the store"),
    pickup: pickupSchema.nullable(),
    customer: contactSchema,
  })
  .superRefine((booking, ctx) => {
    if (booking.fulfilmentType === FulfilmentType.PICKUP_DELIVERY && !booking.pickup) {
      ctx.addIssue({ code: "custom", path: ["pickup"], message: "Enter your pickup details" });
    }
  })
  // A drop-off has no address or pickup time, whatever was sent.
  .transform((booking) => (booking.fulfilmentType === FulfilmentType.DROP_OFF ? { ...booking, pickup: null } : booking));

export type BookingRequest = z.input<typeof bookingRequestSchema>;
export type BookingInput = z.output<typeof bookingRequestSchema>;

// The slug from the booking page's address.
export const storeSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]{1,64}$/);
