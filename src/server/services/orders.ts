import "server-only";

import type { StoreRole } from "@/generated/prisma/client";
import { fromStoredCoordinates, type Coordinates } from "@/lib/location";
import { formatNaira } from "@/lib/money";
import { formatOrderNumber, summarizeServices } from "@/lib/orders";
import { canRecordPaymentAt, isRecordPaymentPrimary } from "@/lib/payments";
import { canReviseQuote, findDeclinedRevision, findPendingRevision } from "@/lib/quotes";
import { formatPickupWindow } from "@/lib/pickup-schedule";
import { fromStoredQuantity } from "@/lib/quantity";
import { formatCalendarDate, formatDateTime, toDateKey } from "@/lib/time";
import { encodeOrderListCursor, type OrderListFilters } from "@/schemas/orders";
import {
  countOpenOrders,
  findOrderDetail,
  findStaffNames,
  listOrders,
  orderExists,
  type OrderDetailRecord,
  type OrderListRecord,
} from "@/server/data/orders";
import { buildOrderTimeline, type TimelineEntry } from "@/server/data/order-timeline";
import { findPickupTimeEvents } from "@/server/data/pickup-times";
import { findRevisionAudits } from "@/server/data/quotes";
import { findOnlinePaymentNotes } from "@/server/data/online-payments";
import { getBalance, type Balance } from "@/server/domain/balance";
import { getAvailableTransitions, getStageOrderState, type AvailableTransitions } from "@/server/domain/order-stages";
import { buildOrderListQuery, ORDER_LIST_PAGE_SIZE } from "@/server/domain/order-list";
import { getPickupTimeRefusal } from "@/server/services/pickup-times";
import { canSendSmsTo } from "@/server/services/notifications";
import { canIssueTrackingLink } from "@/server/services/tracking-links";
import type { OrderListCursor, OrderListPage, OrderListRow } from "@/types/orders";

// Reading a store's orders: the orders list, the order detail, and the
// sidebar's open-order count. Read-only. The store always comes from the
// caller's membership.

export interface OrderListStore {
  id: string;
  orderPrefix: string;
  timeZone: string;
}

export async function getOrderListPage(
  store: OrderListStore,
  filters: OrderListFilters,
  now: Date,
  after: OrderListCursor | null = null,
): Promise<OrderListPage> {
  const query = buildOrderListQuery(filters, store, now, after);
  const { orders, hasMore } = await listOrders(store.id, query, ORDER_LIST_PAGE_SIZE);
  const last = orders.at(-1);
  return {
    rows: orders.map((order) => toListRow(order, store)),
    nextCursor: hasMore && last ? encodeOrderListCursor(last) : null,
  };
}

function toListRow(order: OrderListRecord, store: OrderListStore): OrderListRow {
  const balance = getBalance(order);
  return {
    id: order.id,
    displayNumber: formatOrderNumber(store, order.orderNumber),
    customerName: order.customer.name,
    services: summarizeServices(
      order.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity === null ? null : fromStoredQuantity(line.quantity.toString()),
      })),
    ),
    total: order.approvedQuote ? formatNaira(order.approvedQuote.total) : null,
    paymentState: balance.state,
    stage: order.stage,
    fulfilmentType: order.fulfilmentType,
    isOutOfArea: order.isOutOfArea,
    created: formatDateTime(order.createdAt, store.timeZone),
    pickup: order.fulfilmentType === "PICKUP_DELIVERY" ? formatListPickup(order) : null,
  };
}

// "Fri, 9 Oct 2026 · 10:00 AM–12:00 PM": the confirmed pickup, or the
// requested one until the store confirms.
function formatListPickup(order: OrderListRecord): string | null {
  const scheduled = order.scheduledPickupDate !== null;
  const date = scheduled ? order.scheduledPickupDate : order.requestedPickupDate;
  const start = scheduled ? order.scheduledWindowStart : order.requestedWindowStart;
  const end = scheduled ? order.scheduledWindowEnd : order.requestedWindowEnd;
  if (!date) return null;
  const day = formatCalendarDate(toDateKey(date));
  return start && end ? `${day} · ${formatPickupWindow({ start, end })}` : day;
}

export interface OrderDetail {
  order: OrderDetailRecord;
  displayNumber: string;
  // The customer's shared location, for "Open in Maps" (owners and staff of
  // this store only). Null when none was shared, or it has been cleared.
  location: Coordinates | null;
  balance: Balance;
  // Staff names by user ID, for the timeline.
  staffNames: Map<string, string>;
  // The stage moves this member may make now (the page shows only these).
  stageMoves: AvailableTransitions;
  // Stage events and revision moments, newest first.
  timeline: TimelineEntry[];
  quote: OrderQuoteState;
  // A pickup order whose time is Requested or Suggested: what staff may do.
  pickupTime: OrderPickupTimeState | null;
  // "Get tracking link" is offered only when the new link would work.
  canIssueTrackingLink: boolean;
  // "Send link by SMS": a Nigerian number, with the store's SMS on.
  canSendLinkBySms: boolean;
  // The store's WhatsApp button setting.
  whatsappEnabled: boolean;
  payments: OrderPaymentActions;
}

// What this member may do in the payments section (the page also needs the
// store to be able to work on existing orders).
export interface OrderPaymentActions {
  // Any order except a cancelled one.
  canRecord: boolean;
  // Ready or Completed with a balance due: Record payment is the main action.
  recordPrimary: boolean;
  // Owners only, on confirmed store-collected payments.
  canVoid: boolean;
  // A payment has started on Paystack but isn't confirmed: the record form
  // says so, so staff don't take the same money again at the counter.
  hasPendingOnlinePayment: boolean;
}

export interface OrderPickupTimeState {
  status: "REQUESTED" | "PROPOSED_BY_STORE";
  canConfirm: boolean;
  canSuggest: boolean;
  // Why neither is possible right now (a pickup charge awaiting approval).
  blockedReason: string | null;
}

type DetailRevision = OrderDetailRecord["quoteRevisions"][number];

export interface OrderQuoteState {
  // Edit quote is offered (up to Ready).
  canEdit: boolean;
  // An unpriced order waiting at Received by store: "Price order" is the main move.
  needsPricing: boolean;
  approvedTotal: number | null;
  // The revision waiting for the customer's approval.
  pending: DetailRevision | null;
  // The newest revision, when the customer declined it.
  declined: DetailRevision | null;
}

// False for an order that isn't this store's, exactly as for one that doesn't exist.
export async function isStoreOrder(storeId: string, orderId: string): Promise<boolean> {
  return orderExists(storeId, orderId);
}

// Null for an order that isn't this store's, exactly as for one that doesn't exist.
export async function getOrderDetail(
  storeId: string,
  orderId: string,
  role: StoreRole,
  now: Date = new Date(),
): Promise<OrderDetail | null> {
  const order = await findOrderDetail(storeId, orderId);
  if (!order) return null;

  const [audits, pickupTimes, onlineNotes] = await Promise.all([
    findRevisionAudits(
      storeId,
      order.quoteRevisions.map((revision) => revision.id),
    ),
    findPickupTimeEvents(storeId, orderId),
    findOnlinePaymentNotes(
      storeId,
      order.payments.filter((payment) => payment.source === "ONLINE" && payment.status === "CONFIRMED").map((payment) => payment.id),
    ),
  ]);
  const timeline = buildOrderTimeline(
    order.statusEvents,
    order.quoteRevisions,
    audits,
    pickupTimes.suggestions,
    pickupTimes.resets,
    order.payments.map((payment) => ({ ...payment, receivedAfter: onlineNotes.get(payment.id) ?? null })),
  );
  const actorIds = timeline.flatMap((entry) => {
    const id =
      entry.kind === "payment"
        ? entry.staffUserId
        : entry.kind === "stage"
        ? entry.event.actorUserId
        : entry.kind === "pickupSuggested"
          ? entry.suggestion.actorUserId
          : entry.kind === "pickupReset"
            ? entry.reset.actorUserId
            : entry.staffUserId;
    return id ? [id] : [];
  });
  const pending = findPendingRevision(order.quoteRevisions);
  const balance = getBalance(order);
  return {
    order,
    displayNumber: formatOrderNumber(order.store, order.orderNumber),
    location: fromStoredCoordinates(order.pickupLatitude, order.pickupLongitude),
    balance,
    staffNames: await findStaffNames(storeId, actorIds),
    stageMoves: getAvailableTransitions(getStageOrderState(order), role),
    timeline,
    quote: {
      canEdit: canReviseQuote(order.stage),
      needsPricing: order.stage === "RECEIVED_BY_STORE" && order.approvedQuoteId === null && pending === null,
      approvedTotal: order.approvedQuote?.total ?? null,
      pending,
      declined: findDeclinedRevision(order.quoteRevisions),
    },
    pickupTime: getPickupTimeState(order, pending !== null),
    canIssueTrackingLink: canIssueTrackingLink(order, now),
    canSendLinkBySms: canSendSmsTo(order.customer.phone, order.store.smsEnabled),
    whatsappEnabled: order.store.whatsappContactEnabled,
    payments: {
      canRecord: canRecordPaymentAt(order.stage),
      recordPrimary: isRecordPaymentPrimary(order.stage, balance.state),
      canVoid: role === "OWNER",
      hasPendingOnlinePayment: order.payments.some((payment) => payment.source === "ONLINE" && payment.status === "PENDING"),
    },
  };
}

function getPickupTimeState(order: OrderDetailRecord, pickupChargeWaiting: boolean): OrderPickupTimeState | null {
  const status = order.pickupWindowStatus;
  if (order.fulfilmentType !== "PICKUP_DELIVERY") return null;
  if (status !== "REQUESTED" && status !== "PROPOSED_BY_STORE") return null;
  if (order.stage !== "BOOKED" && order.stage !== "QUOTE_AWAITING_APPROVAL") return null;
  const refusal = getPickupTimeRefusal(order, pickupChargeWaiting);
  return {
    status,
    canConfirm: refusal === null && status === "REQUESTED",
    canSuggest: refusal === null,
    blockedReason: refusal,
  };
}

export async function getOpenOrderCount(storeId: string): Promise<number> {
  return countOpenOrders(storeId);
}
