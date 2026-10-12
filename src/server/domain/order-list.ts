import "server-only";

import { parseOrderNumberSearch } from "@/lib/orders";
import { toPhoneSearchDigits } from "@/lib/phone";
import { addDaysToDateKey, getLocalDateKey, startOfLocalDay } from "@/lib/time";
import type { OrderDateRange, OrderListFilters } from "@/schemas/orders";
import type { OrderListCursor, OrderListQuery } from "@/types/orders";

export const ORDER_LIST_PAGE_SIZE = 25;

// Days before today included by each created-date filter.
const RANGE_DAYS_BEFORE_TODAY: Record<Exclude<OrderDateRange, "all">, number> = { today: 0, "7d": 6, "30d": 29 };

// The page's search and filters as a list query. One search box matches the
// order number, any part of the phone, and any part of the name all at once,
// so no input is ever an error: text that isn't an order number just matches
// no number. Date ranges are calendar days in the store's time zone (today
// plus the 6 or 29 days before), converted to UTC only here.
export function buildOrderListQuery(
  filters: OrderListFilters,
  store: { orderPrefix: string; timeZone: string },
  now: Date,
  after: OrderListCursor | null = null,
): OrderListQuery {
  const text = filters.q.trim();
  const search = text
    ? { orderNumber: parseOrderNumberSearch(text, store.orderPrefix), phoneDigits: toPhoneSearchDigits(text), name: text }
    : null;

  let createdFrom: Date | null = null;
  if (filters.created !== "all") {
    const today = getLocalDateKey(now, store.timeZone);
    createdFrom = startOfLocalDay(addDaysToDateKey(today, -RANGE_DAYS_BEFORE_TODAY[filters.created]), store.timeZone);
  }

  return {
    search,
    stage: filters.stage,
    paymentState: filters.payment,
    fulfilmentType: filters.type,
    createdFrom,
    after,
  };
}
