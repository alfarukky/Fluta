import "server-only";

import type { StoreRole } from "@/generated/prisma/client";
import { formatNaira } from "@/lib/money";
import { formatOrderNumber, summarizeServices } from "@/lib/orders";
import { canReviseQuote, findDeclinedRevision, findPendingRevision } from "@/lib/quotes";
import { formatPickupWindow } from "@/lib/pickup-schedule";
import { fromDecimalString } from "@/lib/quantity";
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
import { findRevisionAudits } from "@/server/data/quotes";
import { getBalance, type Balance } from "@/server/domain/balance";
import { getAvailableTransitions, getStageOrderState, type AvailableTransitions } from "@/server/domain/order-stages";
import { buildOrderListQuery, ORDER_LIST_PAGE_SIZE } from "@/server/domain/order-list";
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
        pricingType: line.pricingType,
        quantity: line.quantity === null ? null : fromDecimalString(line.quantity.toString()),
      })),
    ),
    total: order.approvedQuote ? formatNaira(order.approvedQuote.total) : null,
    paymentState: balance.state,
    stage: order.stage,
    fulfilmentType: order.fulfilmentType,
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
  balance: Balance;
  // Staff names by user ID, for the timeline.
  staffNames: Map<string, string>;
  // The stage moves this member may make now (the page shows only these).
  stageMoves: AvailableTransitions;
  // Stage events and revision moments, newest first.
  timeline: TimelineEntry[];
  quote: OrderQuoteState;
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
export async function getOrderDetail(storeId: string, orderId: string, role: StoreRole): Promise<OrderDetail | null> {
  const order = await findOrderDetail(storeId, orderId);
  if (!order) return null;

  const audits = await findRevisionAudits(
    storeId,
    order.quoteRevisions.map((revision) => revision.id),
  );
  const timeline = buildOrderTimeline(order.statusEvents, order.quoteRevisions, audits);
  const actorIds = timeline.flatMap((entry) => {
    const id = entry.kind === "stage" ? entry.event.actorUserId : entry.staffUserId;
    return id ? [id] : [];
  });
  const pending = findPendingRevision(order.quoteRevisions);
  return {
    order,
    displayNumber: formatOrderNumber(order.store, order.orderNumber),
    balance: getBalance(order),
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
  };
}

export async function getOpenOrderCount(storeId: string): Promise<number> {
  return countOpenOrders(storeId);
}
