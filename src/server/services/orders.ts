import "server-only";

import { formatNaira } from "@/lib/money";
import { formatOrderNumber, summarizeServices } from "@/lib/orders";
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
import { getBalance, type Balance } from "@/server/domain/balance";
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
}

// False for an order that isn't this store's, exactly as for one that doesn't exist.
export async function isStoreOrder(storeId: string, orderId: string): Promise<boolean> {
  return orderExists(storeId, orderId);
}

// Null for an order that isn't this store's, exactly as for one that doesn't exist.
export async function getOrderDetail(storeId: string, orderId: string): Promise<OrderDetail | null> {
  const order = await findOrderDetail(storeId, orderId);
  if (!order) return null;

  const actorIds = order.statusEvents.flatMap((event) => (event.actorUserId ? [event.actorUserId] : []));
  return {
    order,
    displayNumber: formatOrderNumber(order.store, order.orderNumber),
    balance: getBalance(order),
    staffNames: await findStaffNames(storeId, actorIds),
  };
}

export async function getOpenOrderCount(storeId: string): Promise<number> {
  return countOpenOrders(storeId);
}
