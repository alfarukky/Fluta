import { describe, expect, it } from "vitest";

import { DEFAULT_ORDER_LIST_FILTERS, orderListFiltersSchema, type OrderListFilters } from "@/schemas/orders";

import { buildOrderListQuery } from "./order-list";

const STORE = { orderPrefix: "FF", timeZone: "Africa/Lagos" };
// 12 October 2026, 00:30 in Lagos (still the 11th in UTC).
const NOW = new Date("2026-10-11T23:30:00Z");

function filters(overrides: Partial<OrderListFilters> = {}): OrderListFilters {
  return { ...DEFAULT_ORDER_LIST_FILTERS, ...overrides };
}

describe("buildOrderListQuery", () => {
  it("has no search or filters by default", () => {
    expect(buildOrderListQuery(filters(), STORE, NOW)).toEqual({
      search: null,
      stage: null,
      paymentState: null,
      fulfilmentType: null,
      createdFrom: null,
      after: null,
    });
  });

  it("searches number, phone, and name together", () => {
    expect(buildOrderListQuery(filters({ q: "FF-1024" }), STORE, NOW).search).toEqual({
      orderNumber: 1024,
      phoneDigits: "1024",
      name: "FF-1024",
    });
    // All digits, so it's also tried as an order number; phone matching runs too.
    expect(buildOrderListQuery(filters({ q: "0803 123" }), STORE, NOW).search).toEqual({
      orderNumber: 803123,
      phoneDigits: "234803123",
      name: "0803 123",
    });
  });

  it.each(["ABC", "12.5", "CW1024"])("searches names and phones for %j without failing", (q) => {
    const search = buildOrderListQuery(filters({ q }), STORE, NOW).search;
    expect(search).toMatchObject({ orderNumber: null, name: q });
  });

  it("passes stage, payment state, and fulfilment type through", () => {
    expect(
      buildOrderListQuery(filters({ stage: "READY", payment: "OUTSTANDING", type: "DROP_OFF" }), STORE, NOW),
    ).toMatchObject({ stage: "READY", paymentState: "OUTSTANDING", fulfilmentType: "DROP_OFF" });
  });

  describe("created date ranges, in the store's time zone", () => {
    it("starts Today at local midnight, even when UTC is still on yesterday", () => {
      // Lagos midnight on the 12th is 23:00 UTC on the 11th.
      expect(buildOrderListQuery(filters({ created: "today" }), STORE, NOW).createdFrom?.toISOString()).toBe(
        "2026-10-11T23:00:00.000Z",
      );
    });

    it("covers today plus the previous 6 or 29 days", () => {
      expect(buildOrderListQuery(filters({ created: "7d" }), STORE, NOW).createdFrom?.toISOString()).toBe(
        "2026-10-05T23:00:00.000Z",
      );
      expect(buildOrderListQuery(filters({ created: "30d" }), STORE, NOW).createdFrom?.toISOString()).toBe(
        "2026-09-12T23:00:00.000Z",
      );
    });
  });
});

describe("orderListFiltersSchema", () => {
  it("reads valid values from the address", () => {
    expect(
      orderListFiltersSchema.parse({ q: " ada ", stage: "READY", payment: "PAID", type: "PICKUP_DELIVERY", created: "7d" }),
    ).toEqual({ q: "ada", stage: "READY", payment: "PAID", type: "PICKUP_DELIVERY", created: "7d" });
  });

  it("falls back to the defaults for anything invalid", () => {
    expect(
      orderListFiltersSchema.parse({ q: ["a", "b"], stage: "DONE", payment: "paid", type: "", created: "yesterday" }),
    ).toEqual(DEFAULT_ORDER_LIST_FILTERS);
  });

  it("defaults to no search and all dates", () => {
    expect(DEFAULT_ORDER_LIST_FILTERS).toEqual({ q: "", stage: null, payment: null, type: null, created: "all" });
  });
});
