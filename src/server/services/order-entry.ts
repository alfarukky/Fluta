import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { formatNaira, lineTotalKobo } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders";
import { getQuantityProblem, isWeighed, MAX_ITEM_QUANTITY, toDecimalString, type QuantityProblem } from "@/lib/quantity";
import { fromDateKey, getLocalDateKey } from "@/lib/time";
import { generateToken, hashToken } from "@/lib/tokens";
import type { CreateOrderInput, PickupInput } from "@/schemas/orders";
import { findCustomer, findCustomerByPhone, searchCustomers, type CustomerRecord } from "@/server/data/customers";
import {
  findActiveServiceArea,
  getFulfilmentOptionsAndSchedule,
  isClosedDate,
  listActiveServiceAreas,
  listClosedDateKeys,
} from "@/server/data/fulfilment";
import {
  findOrderByClientRequestId,
  findOrderSummary,
  insertOrder,
  type CreatedOrder,
  type NewOrderData,
  type NewOrderLineData,
} from "@/server/data/orders";
import { findActiveServices, listActiveServices, type OrderableService } from "@/server/data/services";
import {
  buildQuoteSnapshot,
  getInitialStage,
  getOrderTotal,
  getPickupProblem,
  isOrderFullyPriced,
  mergeServiceLines,
  type PickupProblem,
} from "@/server/domain/orders";

// Staff-entered orders (counter, phone, WhatsApp). storeId and the user
// always come from the caller's membership (see src/actions/orders.ts); IDs
// in the request are only used when they belong to that store. The browser
// sends only services and quantities: every price comes from the catalogue
// or the service area, here.

export type OrderEntryError =
  | "FULFILMENT_NOT_OFFERED"
  | "CUSTOMER_NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "INVALID_QUANTITY"
  | "AREA_UNAVAILABLE"
  | "CHARGE_REQUIRED"
  | "PICKUP_NOT_AVAILABLE"
  | "NEGATIVE_TOTAL";

export type CreateOrderResult =
  | { ok: true; orderId: string; displayNumber: string }
  | { ok: false; error: OrderEntryError; fieldErrors: Record<string, string> };

type Failure = Extract<CreateOrderResult, { ok: false }>;

export interface OrderEntryActor {
  storeId: string;
  timeZone: string;
  userId: string;
}

export async function createStaffOrder(
  actor: OrderEntryActor,
  input: CreateOrderInput,
  now: Date,
): Promise<CreateOrderResult> {
  const prepared = await prepareOrder(actor, input, now);
  if (!prepared.ok) return prepared;

  try {
    return created(await insertOrder(actor.storeId, prepared.data));
  } catch (error) {
    // The same request again (a double tap, a retry): the database's unique
    // rule refused a second order, so return the first one.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await findOrderByClientRequestId(actor.storeId, input.clientRequestId);
    if (!existing) throw error;
    return created(existing);
  }
}

function created(order: CreatedOrder): CreateOrderResult {
  return { ok: true, orderId: order.id, displayNumber: formatOrderNumber(order, order.orderNumber) };
}

async function prepareOrder(
  actor: OrderEntryActor,
  input: CreateOrderInput,
  now: Date,
): Promise<{ ok: true; data: NewOrderData } | Failure> {
  const settings = await getFulfilmentOptionsAndSchedule(actor.storeId);
  const offered = input.fulfilmentType === "DROP_OFF" ? settings.dropOffEnabled : settings.pickupDeliveryEnabled;
  if (!offered) {
    return fail("FULFILMENT_NOT_OFFERED", "fulfilmentType", "Your store doesn't offer this right now. Choose another option.");
  }

  const customer = await resolveCustomer(actor.storeId, input.customer);
  if (!customer.ok) return customer;

  const serviceLines = await priceServiceLines(actor.storeId, input.serviceLines);
  if (!serviceLines.ok) return serviceLines;

  const fulfilment = input.pickup
    ? await resolvePickup(actor, settings, input.pickup, now)
    : ({ ok: true, fields: NO_PICKUP } as const);
  if (!fulfilment.ok) return fulfilment;

  const adjustmentLines = input.adjustments.map(toAdjustmentLine);
  const fulfilmentCharge = fulfilment.fields.fulfilmentCharge;
  const total = getOrderTotal({
    serviceLineTotals: serviceLines.lines.map((line) => line.lineTotal),
    adjustments: input.adjustments.map((adjustment) => adjustment.amount),
    fulfilmentCharge,
  });
  if (total < 0) {
    return fail("NEGATIVE_TOTAL", "adjustments", `Discounts can't make the total less than ₦0 (it would be ${formatNaira(total)}).`);
  }

  const fullyPriced = isOrderFullyPriced({
    fulfilmentType: input.fulfilmentType,
    lines: serviceLines.lines.map((line) => ({ requiresQuote: line.requiresQuote, quantity: line.quantityHundredths })),
    fulfilmentCharge,
  });
  const snapshot = buildQuoteSnapshot(
    [...serviceLines.lines, ...adjustmentLines].map((line) => ({
      ...line,
      quantity: line.quantityHundredths,
      estimate: line.estimateHundredths,
    })),
    fulfilmentCharge,
  );

  return {
    ok: true,
    data: {
      clientRequestId: input.clientRequestId,
      customer: customer.value,
      channel: input.channel,
      fulfilmentType: input.fulfilmentType,
      stage: getInitialStage(input.channel, input.fulfilmentType),
      ...fulfilment.fields,
      // The raw token isn't shown or sent yet (tracking links are Feature 14);
      // only its hash is ever stored.
      trackingTokenHash: hashToken(generateToken()),
      internalNote: input.internalNote,
      lines: [...serviceLines.lines, ...adjustmentLines].map(toLineData),
      revision: { ...snapshot, approved: fullyPriced },
      actor: { type: "STAFF", userId: actor.userId },
      now,
    },
  };
}

function fail(error: OrderEntryError, field: string, message: string): Failure {
  return { ok: false, error, fieldErrors: { [field]: message } };
}

async function resolveCustomer(
  storeId: string,
  customer: CreateOrderInput["customer"],
): Promise<{ ok: true; value: NewOrderData["customer"] } | Failure> {
  if (customer.kind === "new") return { ok: true, value: customer };
  const existing = await findCustomer(storeId, customer.customerId);
  if (!existing) return fail("CUSTOMER_NOT_FOUND", "customer", "We couldn't find this customer. Search again or add them.");
  return { ok: true, value: { kind: "existing", customerId: existing.id } };
}

interface PricedLine extends Omit<NewOrderLineData, "quantity" | "estimatedQuantity"> {
  quantityHundredths: number | null;
  estimateHundredths: number | null;
}

const QUANTITY_MESSAGES: Record<"ITEMS" | "WEIGHT", Record<QuantityProblem | "REQUIRED", string>> = {
  ITEMS: {
    REQUIRED: "Enter how many",
    INVALID: "Enter a whole number",
    TOO_SMALL: "Enter at least 1",
    TOO_LARGE: `Enter ${MAX_ITEM_QUANTITY} or fewer`,
  },
  WEIGHT: {
    REQUIRED: "Enter the weight",
    INVALID: "Enter the weight in kg, like 2.5",
    TOO_SMALL: "Enter at least 0.1 kg",
    TOO_LARGE: "Enter 999.99 kg or less",
  },
};

// Each line's name, price, pricing type, and quote flag come from the store's
// own active service; repeated services become one line.
async function priceServiceLines(
  storeId: string,
  requested: CreateOrderInput["serviceLines"],
): Promise<{ ok: true; lines: PricedLine[] } | Failure> {
  const merged = mergeServiceLines(
    requested.map((line) => ({ serviceId: line.serviceId, quantity: line.quantity, estimate: line.estimate })),
  );
  const services = new Map(
    (await findActiveServices(storeId, merged.map((line) => line.serviceId))).map((service) => [service.id, service]),
  );

  const fieldErrors: Record<string, string> = {};
  const lines: PricedLine[] = [];
  for (const [index, line] of merged.entries()) {
    const service = services.get(line.serviceId);
    if (!service) {
      fieldErrors[`serviceLines.${index}.serviceId`] = "This service isn't available any more. Remove it.";
      continue;
    }
    const problem = getLineQuantityProblem(service, line.quantity, line.estimate);
    if (problem) {
      fieldErrors[`serviceLines.${index}.${problem.field}`] = problem.message;
      continue;
    }
    lines.push(toServiceLine(service, line.quantity, line.estimate));
  }

  const keys = Object.keys(fieldErrors);
  if (keys.length === 0) return { ok: true, lines };
  const error = keys.some((key) => key.endsWith("serviceId")) ? "SERVICE_UNAVAILABLE" : "INVALID_QUANTITY";
  return { ok: false, error, fieldErrors };
}

// Items and packages always need a quantity; a per-kg line may wait to be
// weighed (per-kg services always require a quote).
function getLineQuantityProblem(
  service: OrderableService,
  quantity: number | null,
  estimate: number | null,
): { field: "quantity" | "estimate"; message: string } | null {
  const messages = QUANTITY_MESSAGES[isWeighed(service.pricingType) ? "WEIGHT" : "ITEMS"];
  if (quantity === null) {
    if (!isWeighed(service.pricingType)) return { field: "quantity", message: messages.REQUIRED };
  } else {
    const problem = getQuantityProblem(quantity, service.pricingType);
    if (problem) return { field: "quantity", message: messages[problem] };
  }
  const estimateProblem = estimate === null ? null : getQuantityProblem(estimate, service.pricingType);
  return estimateProblem ? { field: "estimate", message: messages[estimateProblem] } : null;
}

function toServiceLine(service: OrderableService, quantity: number | null, estimate: number | null): PricedLine {
  return {
    lineType: "SERVICE",
    serviceId: service.id,
    description: service.name,
    pricingType: service.pricingType,
    requiresQuote: service.requiresQuote,
    unitPrice: service.price,
    quantityHundredths: quantity,
    estimateHundredths: estimate,
    lineTotal: quantity === null ? null : lineTotalKobo(service.price, quantity),
  };
}

function toAdjustmentLine(adjustment: CreateOrderInput["adjustments"][number]): PricedLine {
  return {
    lineType: "ADJUSTMENT",
    serviceId: null,
    description: adjustment.description,
    pricingType: null,
    requiresQuote: false,
    unitPrice: null,
    quantityHundredths: null,
    estimateHundredths: null,
    lineTotal: adjustment.amount,
  };
}

function toLineData({ quantityHundredths, estimateHundredths, ...line }: PricedLine): NewOrderLineData {
  return {
    ...line,
    quantity: quantityHundredths === null ? null : toDecimalString(quantityHundredths),
    estimatedQuantity: estimateHundredths === null ? null : toDecimalString(estimateHundredths),
  };
}

type FulfilmentFields = Pick<
  NewOrderData,
  | "serviceAreaId"
  | "serviceAreaName"
  | "isOutOfArea"
  | "isOutsideSchedule"
  | "fulfilmentCharge"
  | "addressText"
  | "pickup"
>;

const NO_PICKUP: FulfilmentFields = {
  serviceAreaId: null,
  serviceAreaName: null,
  isOutOfArea: false,
  isOutsideSchedule: false,
  fulfilmentCharge: null,
  addressText: null,
  pickup: null,
};

const PICKUP_MESSAGES: Record<PickupProblem["reason"], string> = {
  DATE_IN_PAST: "Choose today or a later date",
  INACTIVE_DAY: "The store doesn't pick up on this day. Choose another date, or tick Outside normal schedule.",
  CLOSED_DATE: "The store is closed on this date. Choose another date, or tick Outside normal schedule.",
  WINDOW_NOT_OFFERED: "Choose one of the pickup windows",
  INVALID_TIME: "Choose a start and end time",
  END_NOT_AFTER_START: "The end time must be after the start time",
};

// Pickup & delivery: the area (an active one of this store's, or a typed name
// outside them), the charge (a fixed area's own, otherwise the one staff
// agreed), and the date and window.
async function resolvePickup(
  actor: OrderEntryActor,
  schedule: Awaited<ReturnType<typeof getFulfilmentOptionsAndSchedule>>,
  pickup: PickupInput,
  now: Date,
): Promise<{ ok: true; fields: FulfilmentFields } | Failure> {
  const area = await resolveArea(actor.storeId, pickup);
  if (!area.ok) return area;

  const problem = getPickupProblem(pickup, {
    today: getLocalDateKey(now, actor.timeZone),
    schedule,
    isClosedDate: !pickup.outsideSchedule && (await isClosedDate(actor.storeId, pickup.date)),
  });
  if (problem) {
    const field = problem.field === "pickupDate" ? "pickup.date" : "pickup.window";
    return fail("PICKUP_NOT_AVAILABLE", field, PICKUP_MESSAGES[problem.reason]);
  }

  return {
    ok: true,
    fields: {
      ...area.fields,
      isOutsideSchedule: pickup.outsideSchedule,
      addressText: pickup.address,
      pickup: { date: fromDateKey(pickup.date), windowStart: pickup.windowStart, windowEnd: pickup.windowEnd, status: "CONFIRMED" },
    },
  };
}

async function resolveArea(
  storeId: string,
  pickup: PickupInput,
): Promise<
  | { ok: true; fields: Pick<FulfilmentFields, "serviceAreaId" | "serviceAreaName" | "isOutOfArea" | "fulfilmentCharge"> }
  | Failure
> {
  if (pickup.area.kind === "outOfArea") {
    // The schema requires the charge for an out-of-area order.
    if (pickup.charge === null) return fail("CHARGE_REQUIRED", "pickup.charge", "Enter the agreed charge, or 0");
    return {
      ok: true,
      fields: { serviceAreaId: null, serviceAreaName: pickup.area.name, isOutOfArea: true, fulfilmentCharge: pickup.charge },
    };
  }

  const area = await findActiveServiceArea(storeId, pickup.area.areaId);
  if (!area) return fail("AREA_UNAVAILABLE", "pickup.area", "This area isn't available any more. Choose another.");
  const fixed = area.chargeType === "FIXED" && area.fixedCharge !== null;
  if (!fixed && pickup.charge === null) {
    return fail("CHARGE_REQUIRED", "pickup.charge", "Enter the charge agreed with the customer, or 0");
  }
  return {
    ok: true,
    fields: {
      serviceAreaId: area.id,
      serviceAreaName: area.name,
      isOutOfArea: false,
      // Whatever the request says, a fixed area's charge is the area's own.
      fulfilmentCharge: fixed ? area.fixedCharge : pickup.charge,
    },
  };
}

// Everything the new-order form needs.
export async function loadOrderEntry(storeId: string, timeZone: string, now: Date) {
  const today = getLocalDateKey(now, timeZone);
  const [services, areas, settings, closedDates] = await Promise.all([
    listActiveServices(storeId),
    listActiveServiceAreas(storeId),
    getFulfilmentOptionsAndSchedule(storeId),
    listClosedDateKeys(storeId, today),
  ]);
  return { services, areas, settings, closedDates, today };
}

// Customers matching what staff typed: part of a phone number (2 or more
// digits once a leading 0 is dropped, so "0803" finds +234 803…) or part of
// a name.
export async function findCustomers(storeId: string, query: string): Promise<CustomerRecord[]> {
  const text = query.trim();
  if (/^[\d\s()+-]+$/.test(text)) {
    const digits = text.replace(/\D/g, "").replace(/^0/, "");
    if (digits.length < 2) return [];
    return searchCustomers(storeId, { phoneDigits: digits });
  }
  return searchCustomers(storeId, { name: text });
}

export async function getCustomerByPhone(storeId: string, phone: string): Promise<CustomerRecord | null> {
  return findCustomerByPhone(storeId, phone);
}

export async function getOrderSummary(storeId: string, orderId: string) {
  return findOrderSummary(storeId, orderId);
}
