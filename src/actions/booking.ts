"use server";

import { headers } from "next/headers";

import { getClientIp, hashClientIp } from "@/lib/client-ip";
import { logger } from "@/lib/logger";
import { BOOKING_EXPIRED_MESSAGE, bookingRequestSchema, storeSlugSchema } from "@/schemas/booking";
import { submitBooking, type SubmitBookingResult } from "@/server/services/booking";
import type { BookingStep } from "@/types/booking";

// A customer's booking from /store/{slug}. No sign-in: the store comes only
// from the slug, and must still accept bookings (getStoreAccess). The service
// re-checks every choice and builds every price.

export type BookingErrorCode =
  | Exclude<SubmitBookingResult, { ok: true }>["error"]
  | "REQUEST_ID_REQUIRED"
  | "INVALID_INPUT"
  | "CREATE_FAILED";

export type BookingActionResult =
  | { ok: true; displayNumber: string }
  | {
      ok: false;
      code: BookingErrorCode;
      message: string;
      // The step to go back to, with the customer's answers kept.
      step?: BookingStep;
      fieldErrors?: Record<string, string>;
    };

const MESSAGES: Record<Exclude<BookingErrorCode, "INVALID_INPUT">, string> = {
  STORE_UNAVAILABLE: "This store isn't available.",
  NOT_ACCEPTING: "This store isn't taking new bookings right now. Please contact the store.",
  NO_ONLINE_BOOKING: "This store isn't taking online bookings right now. Please contact the store.",
  FULFILMENT_NOT_OFFERED: "That option isn't available any more. Please choose another.",
  CUSTOMER_NOT_FOUND: "Check your details and try again.",
  SERVICE_UNAVAILABLE: "A service you chose isn't available any more. Please check your services.",
  INVALID_QUANTITY: "Please check the amounts you entered.",
  AREA_UNAVAILABLE: "That area isn't available any more. Please choose another.",
  CHARGE_REQUIRED: "That area isn't available any more. Please choose another.",
  PICKUP_NOT_AVAILABLE: "That pickup time is no longer available. Please choose another.",
  NEGATIVE_TOTAL: "Please check your services.",
  BOOKING_LIMIT_REACHED: "Too many bookings from this number or connection. Please try again later or contact the store.",
  REQUEST_ID_REQUIRED: BOOKING_EXPIRED_MESSAGE,
  CREATE_FAILED: "We couldn't send your booking. Please try again.",
};

const ERROR_STEPS: Partial<Record<BookingErrorCode, BookingStep>> = {
  SERVICE_UNAVAILABLE: "services",
  INVALID_QUANTITY: "services",
  NEGATIVE_TOTAL: "services",
  FULFILMENT_NOT_OFFERED: "fulfilment",
  AREA_UNAVAILABLE: "pickup",
  CHARGE_REQUIRED: "pickup",
  PICKUP_NOT_AVAILABLE: "pickup",
  CUSTOMER_NOT_FOUND: "details",
};

// The first part of a field's path, as the step that shows it.
const FIELD_STEPS: Record<string, BookingStep> = {
  serviceLines: "services",
  customerNote: "services",
  fulfilmentType: "fulfilment",
  pickup: "pickup",
  customer: "details",
};

export async function createBooking(slug: unknown, request: unknown): Promise<BookingActionResult> {
  const store = storeSlugSchema.safeParse(slug);
  if (!store.success) return { ok: false, code: "STORE_UNAVAILABLE", message: MESSAGES.STORE_UNAVAILABLE };

  const parsed = bookingRequestSchema.safeParse(request);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "clientRequestId")) {
      return { ok: false, code: "REQUEST_ID_REQUIRED", message: MESSAGES.REQUEST_ID_REQUIRED };
    }
    const fieldErrors = toFieldErrors(parsed.error.issues);
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Please check your answers and try again.",
      step: firstStep(Object.keys(fieldErrors)),
      fieldErrors,
    };
  }

  try {
    const ipHash = hashClientIp(getClientIp(await headers()));
    const result = await submitBooking(store.data, parsed.data, ipHash, new Date());
    if (result.ok) return { ok: true, displayNumber: result.displayNumber };
    return {
      ok: false,
      code: result.error,
      message: MESSAGES[result.error],
      step: ERROR_STEPS[result.error] ?? firstStep(Object.keys(result.fieldErrors)),
      fieldErrors: result.fieldErrors,
    };
  } catch (error) {
    // The error's class and code only: the message can repeat the query's
    // values, such as a phone number or an address.
    logger.error(`[booking] a booking at store "${store.data}" failed:`, describeError(error));
    return { ok: false, code: "CREATE_FAILED", message: MESSAGES.CREATE_FAILED };
  }
}

function firstStep(fields: readonly string[]): BookingStep | undefined {
  for (const field of fields) {
    const step = FIELD_STEPS[field.split(".")[0]];
    if (step) return step;
  }
  return undefined;
}

// "customer.name", "serviceLines.0.amount": the first message per field.
function toFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.map(String).join(".") || "form";
    fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
