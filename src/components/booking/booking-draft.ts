import type { FulfilmentType } from "@/generated/prisma/enums";
import { getBookingPriceSummary, toBookingLineAmount, type BookingPriceSummary } from "@/lib/booking";
import type { Coordinates } from "@/lib/location";
import { lineTotalKobo } from "@/lib/money";
import { getQuantityProblem, isWeighed, MAX_ITEM_QUANTITY, parseHundredths } from "@/lib/quantity";
import { UNLISTED_AREA_ID, UNLISTED_AREA_NAME_MIN, type BookingRequest } from "@/schemas/booking";
import { ADDRESS_MAX, CUSTOMER_NAME_MAX, CUSTOMER_NOTE_MAX } from "@/schemas/field-limits";
import { AREA_NAME_MAX } from "@/schemas/fulfilment";
import type { BookingOptions, BookingService, BookingStep } from "@/types/booking";

// The booking form's answers, kept as typed so moving between steps never
// loses anything, and the checks each step runs before Continue. The server
// checks everything again: these only save the customer a round trip.

export interface BookingDraft {
  // Chosen services in the order they were picked, with the amount as typed.
  lines: { serviceId: string; amount: string }[];
  note: string; // "Anything else?", optional
  fulfilmentType: FulfilmentType | null;
  areaId: string; // an area's ID, UNLISTED_AREA_ID, or ""
  areaName: string; // typed for "My area isn't listed"
  address: string;
  // Shared with "Use my current location", only to help find the address.
  location: Coordinates | null;
  date: string; // "YYYY-MM-DD", or ""
  window: string; // "10:00-12:00", or ""
  name: string;
  phone: string;
  email: string;
}

export const EMPTY_DRAFT: BookingDraft = {
  lines: [],
  note: "",
  fulfilmentType: null,
  areaId: "",
  areaName: "",
  address: "",
  location: null,
  date: "",
  window: "",
  name: "",
  phone: "",
  email: "",
};

// A store that offers only one way gets it chosen already.
export function createDraft(options: Pick<BookingOptions, "dropOff" | "pickup">): BookingDraft {
  const only = options.dropOff !== options.pickup ? (options.dropOff ? "DROP_OFF" : "PICKUP_DELIVERY") : null;
  return { ...EMPTY_DRAFT, fulfilmentType: only };
}

export function windowKey(start: string, end: string): string {
  return `${start}-${end}`;
}

export function parseWindowKey(key: string): { start: string; end: string } | null {
  const [start, end] = key.split("-");
  return start && end ? { start, end } : null;
}

// The steps this booking goes through: pickup details only for a pickup.
export function getSteps(draft: Pick<BookingDraft, "fulfilmentType">): BookingStep[] {
  return draft.fulfilmentType === "PICKUP_DELIVERY"
    ? ["services", "fulfilment", "pickup", "details", "review"]
    : ["services", "fulfilment", "details", "review"];
}

export type DraftErrors = Record<string, string>;

// Field keys: "service.{id}", "services", "note", "fulfilmentType", "areaId",
// "areaName", "address", "date", "window", "name", "phone", "email".
export function validateStep(step: BookingStep, draft: BookingDraft, options: BookingOptions): DraftErrors {
  switch (step) {
    case "services":
      return validateServices(draft, options.services);
    case "fulfilment":
      return draft.fulfilmentType ? {} : { fulfilmentType: "Choose how you'll get your laundry to the store" };
    case "pickup":
      return validatePickup(draft, options);
    case "details":
      return validateDetails(draft);
    case "review":
      return {};
  }
}

function validateServices(draft: BookingDraft, services: readonly BookingService[]): DraftErrors {
  if (draft.lines.length === 0) return { services: "Choose at least one service" };
  const errors: DraftErrors = {};
  for (const line of draft.lines) {
    const service = services.find((candidate) => candidate.id === line.serviceId);
    if (!service) {
      errors[`service.${line.serviceId}`] = "This service isn't available any more. Remove it.";
      continue;
    }
    const message = getAmountMessage(service, line.amount);
    if (message) errors[`service.${line.serviceId}`] = message;
  }
  if (draft.note.trim().length > CUSTOMER_NOTE_MAX) errors.note = `Note must be ${CUSTOMER_NOTE_MAX} characters or fewer`;
  return errors;
}

// How many (required, 1–999), or the estimated weight (optional, 0.1–999.99 kg).
export function getAmountMessage(service: Pick<BookingService, "pricingType">, text: string): string | null {
  const weighed = isWeighed(service.pricingType);
  if (!text.trim()) return weighed ? null : "Enter how many";
  const hundredths = parseHundredths(text);
  const problem = hundredths === null ? "INVALID" : getQuantityProblem(hundredths, service.pricingType);
  if (!problem) return null;
  if (weighed) {
    return { INVALID: "Enter the weight in kg, like 2.5", TOO_SMALL: "Enter at least 0.1 kg", TOO_LARGE: "Enter 999.99 kg or less" }[
      problem
    ];
  }
  return { INVALID: "Enter a whole number", TOO_SMALL: "Enter at least 1", TOO_LARGE: `Enter ${MAX_ITEM_QUANTITY} or fewer` }[problem];
}

function validatePickup(draft: BookingDraft, options: BookingOptions): DraftErrors {
  const errors: DraftErrors = {};
  if (!getChosenArea(draft, options)) errors.areaId = "Choose your area";
  if (draft.areaId === UNLISTED_AREA_ID && options.defaultFee !== null) {
    const name = draft.areaName.trim();
    if (!name) errors.areaName = "Enter your area";
    else if (name.length < UNLISTED_AREA_NAME_MIN || name.length > AREA_NAME_MAX) {
      errors.areaName = `Area name must be ${UNLISTED_AREA_NAME_MIN} to ${AREA_NAME_MAX} characters`;
    }
  }
  const address = draft.address.trim();
  if (!address) errors.address = "Enter your address";
  else if (address.length > ADDRESS_MAX) errors.address = `Address must be ${ADDRESS_MAX} characters or fewer`;
  const date = options.dates.find((option) => option.date === draft.date);
  if (!date) errors.date = "Choose a pickup date";
  else if (!date.windows.some((window) => windowKey(window.start, window.end) === draft.window)) {
    errors.window = "Choose a pickup time";
  }
  return errors;
}

export interface ChosenArea {
  name: string;
  // Kobo, or null when the store will confirm it.
  charge: number | null;
}

// The listed area chosen, or "My area isn't listed" (the typed name at the
// store's default fee) when the store offers it. Null when nothing valid is
// chosen.
export function getChosenArea(draft: Pick<BookingDraft, "areaId" | "areaName">, options: BookingOptions): ChosenArea | null {
  if (draft.areaId === UNLISTED_AREA_ID) {
    return options.defaultFee === null ? null : { name: draft.areaName.trim(), charge: options.defaultFee };
  }
  const area = options.areas.find((candidate) => candidate.id === draft.areaId);
  if (!area) return null;
  return { name: area.name, charge: area.chargeType === "FIXED" ? area.fixedCharge : null };
}

export const SHORT_ADDRESS_MIN_LENGTH = 20;
export const SHORT_ADDRESS_MIN_WORDS = 3;

// A typed address that probably can't be found: under 20 characters, or
// fewer than three words. Only a warning: it never stops Continue (an empty
// address is validatePickup's error instead).
export function isShortAddress(address: string): boolean {
  const text = address.trim();
  if (!text) return false;
  const words = text.split(/[\s,]+/).filter(Boolean).length;
  return text.length < SHORT_ADDRESS_MIN_LENGTH || words < SHORT_ADDRESS_MIN_WORDS;
}

// The phone number and email are checked properly on the server, which
// sends any problem back to this step.
function validateDetails(draft: BookingDraft): DraftErrors {
  const errors: DraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Enter your name";
  else if (name.length < 2) errors.name = "Name must be at least 2 characters";
  else if (name.length > CUSTOMER_NAME_MAX) errors.name = `Name must be ${CUSTOMER_NAME_MAX} characters or fewer`;
  const digits = draft.phone.replace(/\D/g, "");
  if (!draft.phone.trim()) errors.phone = "Enter your phone number";
  else if (digits.length < 7 || digits.length > 15) errors.phone = "Enter a valid phone number";
  const email = draft.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address";
  return errors;
}

// What is sent: IDs, amounts, the choices, and contact details. Never a price.
export function toBookingRequest(draft: BookingDraft, clientRequestId: string): BookingRequest {
  const window = parseWindowKey(draft.window);
  const pickup = draft.fulfilmentType === "PICKUP_DELIVERY";
  return {
    clientRequestId,
    serviceLines: draft.lines.map((line) => ({ serviceId: line.serviceId, amount: line.amount })),
    fulfilmentType: draft.fulfilmentType ?? "DROP_OFF",
    pickup:
      pickup && window
        ? {
            areaId: draft.areaId,
            ...(draft.areaId === UNLISTED_AREA_ID && { areaName: draft.areaName }),
            ...(draft.location && { location: draft.location }),
            address: draft.address,
            date: draft.date,
            windowStart: window.start,
            windowEnd: window.end,
          }
        : null,
    customer: { name: draft.name, phone: draft.phone, email: draft.email },
    customerNote: draft.note,
  };
}

const PICKUP_FIELDS: Record<string, string> = {
  areaId: "areaId",
  areaName: "areaName",
  address: "address",
  date: "date",
  window: "window",
  windowStart: "window",
  windowEnd: "window",
};

// The server's field keys ("serviceLines.0.quantity", "pickup.areaId",
// "customer.phone") as this form's.
export function fromServerErrors(fieldErrors: Record<string, string>, draft: BookingDraft): DraftErrors {
  const errors: DraftErrors = {};
  for (const [key, message] of Object.entries(fieldErrors)) {
    const [group, index] = key.split(".");
    let name: string | null = null;
    if (group === "serviceLines") {
      const line = index === undefined ? undefined : draft.lines[Number(index)];
      name = line ? `service.${line.serviceId}` : "services";
    } else if (group === "pickup") {
      name = PICKUP_FIELDS[index ?? ""] ?? "date";
    } else if (group === "customer" && index) {
      name = index;
    } else if (group === "fulfilmentType") {
      name = "fulfilmentType";
    } else if (group === "customerNote") {
      name = "note";
    }
    if (name) errors[name] ??= message;
  }
  return errors;
}

export interface ReviewLine {
  serviceId: string;
  name: string;
  amount: number | null; // hundredths, as entered
  isEstimate: boolean;
  lineTotal: number | null; // null when the store prices it
}

export interface BookingReview {
  lines: ReviewLine[];
  // The pickup & delivery charge: a number, or null when the store confirms it.
  pickupCharge: number | null;
  summary: BookingPriceSummary;
}

export function reviewBooking(draft: BookingDraft, options: BookingOptions): BookingReview {
  const fulfilmentType = draft.fulfilmentType ?? "DROP_OFF";
  const priced = draft.lines.flatMap((line) => {
    const service = options.services.find((candidate) => candidate.id === line.serviceId);
    if (!service) return [];
    const amount = line.amount.trim() ? parseHundredths(line.amount) : null;
    return [{ service, amount, ...toBookingLineAmount(service, amount) }];
  });
  const pickupCharge = getChosenArea(draft, options)?.charge ?? null;
  const summary = getBookingPriceSummary({
    fulfilmentType,
    lines: priced.map(({ service, quantity, estimate }) => ({ ...service, quantity, estimate })),
    fulfilmentCharge: pickupCharge,
  });
  return {
    lines: priced.map(({ service, amount, quantity }) => ({
      serviceId: service.id,
      name: service.name,
      amount,
      isEstimate: quantity === null,
      lineTotal: quantity === null ? null : lineTotalKobo(service.price, quantity),
    })),
    pickupCharge,
    summary,
  };
}
