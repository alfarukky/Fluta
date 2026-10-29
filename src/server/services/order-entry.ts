import "server-only";

import { getBookingDateOptions, isBookablePickup, toBookingLineAmount } from "@/lib/booking";
import { MESSAGE_TEMPLATES } from "@/lib/messages";
import { PAYSTACK_EMAIL_REQUIRED } from "@/lib/online-payment";
import { formatNaira, getLineTotal } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders";
import { getQuantityMessage, toStoredQuantity } from "@/lib/quantity";
import { fromDateKey, getLocalDateKey, getMinutesInTimeZone } from "@/lib/time";
import { generateToken, hashToken } from "@/lib/tokens";
import { UNLISTED_AREA_ID, type BookingInput } from "@/schemas/booking";
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

import { customerMessages, sendAfterCommit } from "./notifications";

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
    const order = await insertOrder(actor.storeId, prepared.data);
    await sendAfterCommit(order.queued);
    return created(order);
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
  // A connected store with pay later off: a fixed-price booking is paid at
  // booking (Book and pay, plan 3.2).
  payAtBooking: boolean;
}

export type OnlineOrderError = OrderEntryError | "BOOKING_LIMIT_REACHED" | "NO_ONLINE_BOOKING" | "EMAIL_REQUIRED";

export type CreateOnlineOrderResult =
  // The raw tracking token, for the confirmation's link (shown once, never
  // stored). Null only if a repeated booking's order can't be given a new one.
  // bookAndPay: the order was created to be paid now (payLater false).
  | { ok: true; orderId: string; displayNumber: string; trackingToken: string | null; bookAndPay: boolean }
  | { ok: false; error: OnlineOrderError; fieldErrors: Record<string, string> };

// A customer's booking: channel Online, no staff user, starting at Booked,
// pay later unless it is Book and pay. Created by insertOnlineOrder, which returns an order this
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
    await sendAfterCommit(result.order.queued);
    return { ...created(result.order), trackingToken: prepared.trackingToken, bookAndPay: !result.order.payLater };
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
  return { ...created(order), trackingToken: replaced ? token : null, bookAndPay: !order.payLater };
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
    input.pickup && input.pickup.areaId !== UNLISTED_AREA_ID ? findActiveServiceArea(actor.storeId, input.pickup.areaId) : null,
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
  // The same link the confirmation shows. Counted against the store's daily
  // booking SMS cap. Book and pay's is always emailed too (plan 3.2).
  const orderLink = (alwaysEmailTo?: string) =>
    customerMessages({
      template: MESSAGE_TEMPLATES.orderLink,
      createdByUserId: null,
      link: { token: trackingToken, stored: true },
      alwaysEmailTo,
    });
  const order = assembleOrder({
    clientRequestId: input.clientRequestId,
    trackingTokenHash: hashToken(trackingToken),
    customer: { kind: "new", ...input.customer, fillMissingEmail: true },
    channel: "ONLINE",
    fulfilmentType: input.fulfilmentType,
    lines: serviceLines.lines,
    fulfilment: fulfilment.fields,
    internalNote: null,
    customerNote: input.customerNote,
    payLater: true,
    bookingIpHash: actor.ipHash,
    actor: { type: "CUSTOMER", userId: null },
    messages: orderLink(),
    now,
  });

  // Book and pay: a connected store with pay later off, and an approved
  // total at creation (no quote-required lines and no quoted charge). Paid
  // on Paystack, which needs an email.
  const bookAndPay = actor.payAtBooking && order.revision.approved && order.revision.total > 0;
  if (!bookAndPay) return { ok: true, trackingToken, data: order };
  if (!input.customer.email) return fail("EMAIL_REQUIRED", "customer.email", PAYSTACK_EMAIL_REQUIRED);
  return { ok: true, trackingToken, data: { ...order, payLater: false, messages: orderLink(input.customer.email) } };
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
  const resolved = resolveBookingArea(settings, area, pickup);
  if (!resolved.ok) return resolved;

  const options = getBookingDateOptions(
    { today: getLocalDateKey(now, actor.timeZone), minutes: getMinutesInTimeZone(now, actor.timeZone) },
    settings,
    new Set(closedDates),
  );
  if (!isBookablePickup(options, { date: pickup.date, start: pickup.windowStart, end: pickup.windowEnd })) {
    return fail("PICKUP_NOT_AVAILABLE", "pickup.window", "That pickup time is no longer available. Please choose another.");
  }

  return {
    ok: true,
    fields: {
      ...resolved.fields,
      isOutsideSchedule: false,
      addressText: pickup.address,
      pickup: { date: fromDateKey(pickup.date), windowStart: pickup.windowStart, windowEnd: pickup.windowEnd, status: "REQUESTED" },
      // Only ever for "Open in Maps": never the area, the charge, or the address.
      pickupLocation: pickup.location,
    },
  };
}

// A listed area (its fixed charge, or none yet when the store will confirm
// it), or "My area isn't listed" at the store's current default fee. A fee
// removed while the customer had the page open is caught here.
function resolveBookingArea(
  settings: OnlineContext["settings"],
  area: OnlineContext["area"],
  pickup: NonNullable<BookingInput["pickup"]>,
): { ok: true; fields: Pick<FulfilmentFields, "serviceAreaId" | "serviceAreaName" | "isOutOfArea" | "fulfilmentCharge"> } | Failure {
  if (pickup.areaId === UNLISTED_AREA_ID) {
    if (settings.defaultDeliveryFee === null || pickup.areaName === null) {
      return fail("AREA_UNAVAILABLE", "pickup.areaId", "This option isn't available any more. Choose your area.");
    }
    return {
      ok: true,
      fields: { serviceAreaId: null, serviceAreaName: pickup.areaName, isOutOfArea: true, fulfilmentCharge: settings.defaultDeliveryFee },
    };
  }
  if (!area) return fail("AREA_UNAVAILABLE", "pickup.areaId", "This area isn't available any more. Choose another.");
  const fixed = area.chargeType === "FIXED" && area.fixedCharge !== null;
  return {
    ok: true,
    fields: {
      serviceAreaId: area.id,
      serviceAreaName: area.name,
      isOutOfArea: false,
      // A quote-required area's charge is left for staff to set (Feature 12).
      fulfilmentCharge: fixed ? area.fixedCharge : null,
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
    return fail("NEGATIVE_TOTAL", "adjustments", `Discounts can't make the total less than ${formatNaira(0)} (it would be ${formatNaira(total)}).`);
  }

  // Sent to the customer in the order link message (never capped), and
  // never shown to staff: they get a fresh one with "Get tracking link".
  const trackingToken = generateToken();
  return {
    ok: true,
    data: assembleOrder({
      clientRequestId: input.clientRequestId,
      trackingTokenHash: hashToken(trackingToken),
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
      messages: customerMessages({
        template: MESSAGE_TEMPLATES.orderLink,
        createdByUserId: actor.userId,
        link: { token: trackingToken, stored: true },
      }),
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
  | "messages"
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
      .map((line) => ({ requiresQuote: line.requiresQuote, quantity: line.quantity })),
    fulfilmentCharge,
  });
  const snapshot = buildQuoteSnapshot(
    lines,
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

function fail<E extends OnlineOrderError = OrderEntryError>(
  error: E,
  field: string,
  message: string,
): { ok: false; error: E; fieldErrors: Record<string, string> } {
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
  quantity: number | null;
  estimate: number | null;
}

// Each line's name, price, pricing type, and quote flag come from the store's
// own active service; repeated services become one line. Online, the
// customer's amount is billed only on a fixed-price line: on a quote-required
// one it is an estimate (toBookingLineAmount), and the store counts the items
// later. Staff always enter the billed quantity.
async function priceServiceLines(
  storeId: string,
  requested: CreateOrderInput["serviceLines"],
  online = false,
  // The store's active services, when the caller has already loaded them.
  catalogue?: readonly OrderableService[],
): Promise<{ ok: true; lines: PricedLine[] } | Failure> {
  const merged = mergeServiceLines(
    requested.map((line) => ({ serviceId: line.serviceId, quantity: line.quantity, estimate: null })),
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
    // Every line needs a whole number from 1 to 999, billed or estimated.
    const problem = getQuantityMessage(line.quantity);
    if (problem) {
      fieldErrors[`serviceLines.${index}.quantity`] = problem;
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

function toServiceLine(service: OrderableService, quantity: number | null, estimate: number | null): PricedLine {
  return {
    lineType: "SERVICE",
    serviceId: service.id,
    description: service.name,
    pricingType: service.pricingType,
    requiresQuote: service.requiresQuote,
    unitPrice: service.price,
    quantity,
    estimate,
    lineTotal: quantity === null ? null : getLineTotal(service.price, quantity),
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
    quantity: null,
    estimate: null,
    lineTotal: adjustment.amount,
  };
}

function toLineData({ quantity, estimate, ...line }: PricedLine): NewOrderLineData {
  return {
    ...line,
    quantity: quantity === null ? null : toStoredQuantity(quantity),
    estimatedQuantity: estimate === null ? null : toStoredQuantity(estimate),
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
  | "pickupLocation"
>;

const NO_PICKUP: FulfilmentFields = {
  serviceAreaId: null,
  serviceAreaName: null,
  isOutOfArea: false,
  isOutsideSchedule: false,
  fulfilmentCharge: null,
  addressText: null,
  pickup: null,
  pickupLocation: null,
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
      // Staff never capture a customer's location (Feature 15b).
      pickupLocation: null,
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
