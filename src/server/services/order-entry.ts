import "server-only";

import { getBookingDateOptions, isBookablePickup, toBookingLineAmount } from "@/lib/booking";
import { formatNaira, lineTotalKobo } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders";
import { getQuantityProblem, isWeighed, MAX_ITEM_QUANTITY, toDecimalString, type QuantityProblem } from "@/lib/quantity";
import { fromDateKey, getLocalDateKey, getMinutesInTimeZone } from "@/lib/time";
import { generateToken, hashToken } from "@/lib/tokens";
import type { BookingInput } from "@/schemas/booking";
import type { CreateOrderInput, PickupInput } from "@/schemas/orders";
import { findCustomer, findCustomerByPhone, searchCustomers, type CustomerRecord } from "@/server/data/customers";
import { isUniqueViolation } from "@/server/data/errors";
import {
  countActiveServiceAreas,
  findActiveServiceArea,
  getFulfilmentOptionsAndSchedule,
  isClosedDate,
  listActiveServiceAreas,
  listClosedDateKeys,
} from "@/server/data/fulfilment";
import {
  findOrderByClientRequestId,
  insertOnlineOrder,
  insertOrder,
  type CreatedOrder,
  type NewOrderData,
  type NewOrderLineData,
} from "@/server/data/orders";
import { replaceBookingTrackingToken } from "@/server/data/tracking";
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
import { isPickupAvailable } from "@/server/domain/pickup-schedule";

// Creating an order, the one path for both staff-entered orders (counter,
// phone, WhatsApp) and customers' online bookings. For staff, storeId and the
// user come from the caller's membership (see src/actions/orders.ts); for a
// booking, storeId comes from the booking page's slug (src/actions/booking.ts).
// IDs in the request are only used when they belong to that store. The
// browser sends only services and quantities: every price comes from the
// catalogue or the service area, here.

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
    if (!isUniqueViolation(error)) throw error;
    const existing = await findOrderByClientRequestId(actor.storeId, input.clientRequestId);
    if (!existing) throw error;
    return created(existing);
  }
}

// ───────────── Online bookings ─────────────

export interface OnlineBookingActor {
  storeId: string;
  timeZone: string;
  // HMAC of the booking's IP address (src/lib/client-ip.ts).
  ipHash: string;
}

export type OnlineOrderError = OrderEntryError | "BOOKING_LIMIT_REACHED" | "NO_ONLINE_BOOKING";

export type CreateOnlineOrderResult =
  // The raw tracking token, for the confirmation's link (shown once, never
  // stored). Null only if a repeated booking's order can't be given a new one.
  | { ok: true; orderId: string; displayNumber: string; trackingToken: string | null }
  | { ok: false; error: OnlineOrderError; fieldErrors: Record<string, string> };

// A customer's booking: channel Online, no staff user, starting at Booked,
// pay later. Created by insertOnlineOrder, which returns an order this
// request already created, then applies the booking limits. Whether the
// store accepts bookings at all is the caller's check (getStoreAccess).
export async function createOnlineOrder(
  actor: OnlineBookingActor,
  input: BookingInput,
  now: Date,
): Promise<CreateOnlineOrderResult> {
  // Loaded together: Neon round trips are slow, and a customer is waiting.
  const [existing, context] = await Promise.all([
    findOrderByClientRequestId(actor.storeId, input.clientRequestId),
    loadOnlineContext(actor, input, now),
  ]);
  // A repeated booking returns its order even if the store has changed since.
  if (existing) return repeatedBooking(actor, input, existing, now);

  const prepared = await prepareOnlineOrder(actor, input, context, now);
  if (!prepared.ok) return prepared;

  try {
    const result = await insertOnlineOrder(actor.storeId, prepared.data);
    if (result.kind === "limitReached") return { ok: false, error: "BOOKING_LIMIT_REACHED", fieldErrors: {} };
    if (result.kind === "existing") return repeatedBooking(actor, input, result.order, now);
    return { ...created(result.order), trackingToken: prepared.trackingToken };
  } catch (error) {
    // The same request with a different phone number: the unique rule
    // refused a second order, so return the first one.
    if (!isUniqueViolation(error)) throw error;
    const order = await findOrderByClientRequestId(actor.storeId, input.clientRequestId);
    if (!order) throw error;
    return repeatedBooking(actor, input, order, now);
  }
}

// The same booking sent again (a retry after a lost response): the customer
// never saw the first link, and only its hash was kept, so the order gets a
// fresh token for the confirmation. The booking page sends one request at a
// time, so the link it shows is always the latest.
async function repeatedBooking(
  actor: OnlineBookingActor,
  input: BookingInput,
  order: CreatedOrder,
  now: Date,
): Promise<CreateOnlineOrderResult> {
  const token = generateToken();
  const replaced = await replaceBookingTrackingToken(actor.storeId, input.clientRequestId, hashToken(token), now);
  return { ...created(order), trackingToken: replaced ? token : null };
}

// What the booking is checked against, read in one go.
interface OnlineContext {
  settings: Awaited<ReturnType<typeof getFulfilmentOptionsAndSchedule>>;
  activeAreaCount: number;
  services: OrderableService[];
  area: Awaited<ReturnType<typeof findActiveServiceArea>>;
  closedDates: string[];
}

async function loadOnlineContext(actor: OnlineBookingActor, input: BookingInput, now: Date): Promise<OnlineContext> {
  const today = getLocalDateKey(now, actor.timeZone);
  const [settings, activeAreaCount, services, area, closedDates] = await Promise.all([
    getFulfilmentOptionsAndSchedule(actor.storeId),
    countActiveServiceAreas(actor.storeId),
    listActiveServices(actor.storeId),
    input.pickup ? findActiveServiceArea(actor.storeId, input.pickup.areaId) : null,
    input.pickup ? listClosedDateKeys(actor.storeId, today) : [],
  ]);
  return { settings, activeAreaCount, services, area, closedDates };
}

// Everything the customer chose is checked again here: what the booking page
// offered is only a convenience.
async function prepareOnlineOrder(
  actor: OnlineBookingActor,
  input: BookingInput,
  context: OnlineContext,
  now: Date,
): Promise<{ ok: true; data: NewOrderData; trackingToken: string } | Extract<CreateOnlineOrderResult, { ok: false }>> {
  const { settings, services } = context;
  const pickupAvailable = isPickupAvailable({ ...settings, activeAreaCount: context.activeAreaCount });
  // No active services, or no way to get the laundry to the store.
  if (services.length === 0 || (!settings.dropOffEnabled && !pickupAvailable)) {
    return { ok: false, error: "NO_ONLINE_BOOKING", fieldErrors: {} };
  }
  const offered = input.fulfilmentType === "DROP_OFF" ? settings.dropOffEnabled : pickupAvailable;
  if (!offered) return fail("FULFILMENT_NOT_OFFERED", "fulfilmentType", "This option isn't available any more.");

  const serviceLines = await priceServiceLines(
    actor.storeId,
    input.serviceLines.map((line) => ({ serviceId: line.serviceId, quantity: line.amount, estimate: null })),
    true,
    services,
  );
  if (!serviceLines.ok) return serviceLines;

  const fulfilment = input.pickup
    ? resolveRequestedPickup(actor, context, input.pickup, now)
    : ({ ok: true, fields: NO_PICKUP } as const);
  if (!fulfilment.ok) return fulfilment;

  // Shown once on the confirmation; only its hash is stored.
  const trackingToken = generateToken();
  return {
    ok: true,
    trackingToken,
    data: assembleOrder({
      clientRequestId: input.clientRequestId,
      trackingTokenHash: hashToken(trackingToken),
      customer: { kind: "new", ...input.customer, fillMissingEmail: true },
      channel: "ONLINE",
      fulfilmentType: input.fulfilmentType,
      lines: serviceLines.lines,
      fulfilment: fulfilment.fields,
      internalNote: null,
      customerNote: input.customerNote,
      // No online payment yet (Feature 17): every booking is paid later.
      payLater: true,
      bookingIpHash: actor.ipHash,
      actor: { type: "CUSTOMER", userId: null },
      now,
    }),
  };
}

// An active area of this store (its fixed charge, or none yet when the store
// will confirm it), and a date and window the booking page would offer now:
// within the next 15 dates, an active day, not closed, one of the store's
// windows, starting at least 2 hours from now. The window is a request.
function resolveRequestedPickup(
  actor: OnlineBookingActor,
  { settings, area, closedDates }: OnlineContext,
  pickup: NonNullable<BookingInput["pickup"]>,
  now: Date,
): { ok: true; fields: FulfilmentFields } | Failure {
  if (!area) return fail("AREA_UNAVAILABLE", "pickup.areaId", "This area isn't available any more. Choose another.");

  const options = getBookingDateOptions(
    { today: getLocalDateKey(now, actor.timeZone), minutes: getMinutesInTimeZone(now, actor.timeZone) },
    settings,
    new Set(closedDates),
  );
  if (!isBookablePickup(options, { date: pickup.date, start: pickup.windowStart, end: pickup.windowEnd })) {
    return fail("PICKUP_NOT_AVAILABLE", "pickup.window", "That pickup time is no longer available. Please choose another.");
  }

  const fixed = area.chargeType === "FIXED" && area.fixedCharge !== null;
  return {
    ok: true,
    fields: {
      serviceAreaId: area.id,
      serviceAreaName: area.name,
      isOutOfArea: false,
      isOutsideSchedule: false,
      // A quote-required area's charge is left for staff to set (Feature 12).
      fulfilmentCharge: fixed ? area.fixedCharge : null,
      addressText: pickup.address,
      pickup: { date: fromDateKey(pickup.date), windowStart: pickup.windowStart, windowEnd: pickup.windowEnd, status: "REQUESTED" },
    },
  };
}

function created(order: CreatedOrder): { ok: true; orderId: string; displayNumber: string } {
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

  return {
    ok: true,
    data: assembleOrder({
      clientRequestId: input.clientRequestId,
      // Staff share a link later with "Get tracking link", which issues a
      // fresh token; this one is never shown.
      trackingTokenHash: hashToken(generateToken()),
      customer: customer.value,
      channel: input.channel,
      fulfilmentType: input.fulfilmentType,
      lines: [...serviceLines.lines, ...adjustmentLines],
      fulfilment: fulfilment.fields,
      internalNote: input.internalNote,
      customerNote: null,
      payLater: false,
      bookingIpHash: null,
      actor: { type: "STAFF", userId: actor.userId },
      now,
    }),
  };
}

type OrderParts = Pick<
  NewOrderData,
  | "clientRequestId"
  | "trackingTokenHash"
  | "customer"
  | "channel"
  | "fulfilmentType"
  | "internalNote"
  | "customerNote"
  | "payLater"
  | "bookingIpHash"
  | "actor"
  | "now"
> & { lines: PricedLine[]; fulfilment: FulfilmentFields };

// Version 1 and everything else the order needs, from its priced lines. A
// fully priced order's version 1 is approved at once by whoever created it
// (staff, or the customer confirming the booking); otherwise it is an
// estimate and the priced quote comes later (Feature 12).
function assembleOrder({ lines, fulfilment, ...order }: OrderParts): NewOrderData {
  const fulfilmentCharge = fulfilment.fulfilmentCharge;
  const fullyPriced = isOrderFullyPriced({
    fulfilmentType: order.fulfilmentType,
    lines: lines
      .filter((line) => line.lineType === "SERVICE")
      .map((line) => ({ requiresQuote: line.requiresQuote, quantity: line.quantityHundredths })),
    fulfilmentCharge,
  });
  const snapshot = buildQuoteSnapshot(
    lines.map((line) => ({ ...line, quantity: line.quantityHundredths, estimate: line.estimateHundredths })),
    { areaName: fulfilment.serviceAreaName, isOutOfArea: fulfilment.isOutOfArea, charge: fulfilmentCharge },
  );

  return {
    ...order,
    stage: getInitialStage(order.channel, order.fulfilmentType),
    ...fulfilment,
    lines: lines.map(toLineData),
    revision: { ...snapshot, approved: fullyPriced },
  };
}

function fail(error: OrderEntryError, field: string, message: string): Failure {
  return { ok: false, error, fieldErrors: { [field]: message } };
}

async function resolveCustomer(
  storeId: string,
  customer: CreateOrderInput["customer"],
): Promise<{ ok: true; value: NewOrderData["customer"] } | Failure> {
  if (customer.kind === "new") return { ok: true, value: { ...customer, fillMissingEmail: false } };
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
// own active service; repeated services become one line. Online, the
// customer's amount is billed only on a fixed-price line: on a quote-required
// one it is an estimate (toBookingLineAmount), and the store weighs or counts
// the items later.
async function priceServiceLines(
  storeId: string,
  requested: CreateOrderInput["serviceLines"],
  online = false,
  // The store's active services, when the caller has already loaded them.
  catalogue?: readonly OrderableService[],
): Promise<{ ok: true; lines: PricedLine[] } | Failure> {
  const merged = mergeServiceLines(
    requested.map((line) => ({ serviceId: line.serviceId, quantity: line.quantity, estimate: line.estimate })),
  );
  const active = catalogue ?? (await findActiveServices(storeId, merged.map((line) => line.serviceId)));
  const services = new Map(active.map((service) => [service.id, service]));

  const fieldErrors: Record<string, string> = {};
  const lines: PricedLine[] = [];
  for (const [index, line] of merged.entries()) {
    const service = services.get(line.serviceId);
    if (!service) {
      fieldErrors[`serviceLines.${index}.serviceId`] = "This service isn't available any more. Remove it.";
      continue;
    }
    const problem = online ? getBookingAmountProblem(service, line.quantity) : getLineQuantityProblem(service, line.quantity, line.estimate);
    if (problem) {
      fieldErrors[`serviceLines.${index}.${problem.field}`] = problem.message;
      continue;
    }
    const { quantity, estimate } = online ? toBookingLineAmount(service, line.quantity) : line;
    lines.push(toServiceLine(service, quantity, estimate));
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

// A customer's amount: how many items or packages (required), or an
// estimated weight (optional).
function getBookingAmountProblem(
  service: OrderableService,
  amount: number | null,
): { field: "quantity"; message: string } | null {
  const messages = QUANTITY_MESSAGES[isWeighed(service.pricingType) ? "WEIGHT" : "ITEMS"];
  if (amount === null) return isWeighed(service.pricingType) ? null : { field: "quantity", message: messages.REQUIRED };
  const problem = getQuantityProblem(amount, service.pricingType);
  return problem ? { field: "quantity", message: messages[problem] } : null;
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
