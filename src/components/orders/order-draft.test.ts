import { describe, expect, it } from "vitest";

import type { OrderEntryArea, OrderEntryService } from "@/types/orders";

import {
  addService,
  chooseArea,
  emptyDraft,
  OUT_OF_AREA,
  reviewDraft,
  toCreateOrderRequest,
  type OrderDraft,
} from "./order-draft";

const shirt: OrderEntryService = { id: "shirt", name: "Shirt", category: "Ironing", pricingType: "PER_ITEM", price: 80_000, requiresQuote: false };
const gown: OrderEntryService = { id: "gown", name: "Wedding gown", category: "Specialist", pricingType: "PER_ITEM", price: 500_000, requiresQuote: true };
const bedding: OrderEntryService = { id: "bedding", name: "Bedding", category: "Household", pricingType: "PER_PACKAGE", price: 250_000, requiresQuote: false };
const services = [shirt, gown, bedding];
const areas: OrderEntryArea[] = [
  { id: "wuse", name: "Wuse 2", chargeType: "FIXED", fixedCharge: 150_000 },
  { id: "maitama", name: "Maitama", chargeType: "QUOTE_REQUIRED", fixedCharge: null },
];

function draft(change: Partial<OrderDraft> = {}): OrderDraft {
  return { ...emptyDraft("DROP_OFF"), ...change };
}

describe("chooseArea", () => {
  it("pre-fills the default fee when moving to out of area, ₦0 included", () => {
    expect(chooseArea({ areaChoice: "wuse" }, OUT_OF_AREA, 250_000)).toEqual({ areaChoice: OUT_OF_AREA, charge: "2,500" });
    expect(chooseArea({ areaChoice: "" }, OUT_OF_AREA, 0)).toEqual({ areaChoice: OUT_OF_AREA, charge: "0" });
  });

  it("leaves the charge alone without a default fee, for a listed area, or when already out of area", () => {
    expect(chooseArea({ areaChoice: "wuse" }, OUT_OF_AREA, null)).toEqual({ areaChoice: OUT_OF_AREA });
    expect(chooseArea({ areaChoice: OUT_OF_AREA }, "wuse", 250_000)).toEqual({ areaChoice: "wuse" });
    expect(chooseArea({ areaChoice: OUT_OF_AREA }, OUT_OF_AREA, 250_000)).toEqual({ areaChoice: OUT_OF_AREA });
  });
});

describe("addService", () => {
  it("adds a new line with a quantity of 1, for every pricing type", () => {
    const withShirt = addService([], shirt, "a");
    expect(withShirt).toEqual({ lines: [{ key: "a", serviceId: "shirt", quantity: "1" }], combined: false });
    expect(addService([], bedding, "b").lines[0].quantity).toBe("1");
    expect(addService([], gown, "c").lines[0].quantity).toBe("1");
  });

  it("adds to an item already on the order", () => {
    const lines = [{ key: "a", serviceId: "shirt", quantity: "2" }];
    expect(addService(lines, shirt, "b")).toEqual({
      lines: [{ key: "a", serviceId: "shirt", quantity: "3" }],
      combined: true,
    });
  });

  it("adds to a quote-required line already on the order too", () => {
    const lines = [{ key: "a", serviceId: "gown", quantity: "1" }];
    expect(addService(lines, gown, "b").lines[0].quantity).toBe("2");
  });
});

describe("toCreateOrderRequest", () => {
  it("sends an existing customer by ID, and only services and quantities", () => {
    const request = toCreateOrderRequest(
      draft({
        selectedCustomer: { id: "cust", name: "Amaka", phone: "+234 803 123 4521", email: null },
        serviceLines: [{ key: "a", serviceId: "shirt", quantity: "2" }],
      }),
      "request-id",
      areas,
    );
    expect(request.customer).toEqual({ kind: "existing", customerId: "cust" });
    expect(request.serviceLines).toEqual([{ serviceId: "shirt", quantity: "2" }]);
    expect(request.pickup).toBeNull();
  });

  it("uses the existing customer when a new customer's phone matches one", () => {
    const request = toCreateOrderRequest(
      draft({
        customerMode: "new",
        newCustomer: { name: "Someone Else", phone: "08031234521", email: "" },
        phoneMatch: { id: "cust", name: "Amaka", phone: "+234 803 123 4521", email: null },
      }),
      "request-id",
      areas,
    );
    expect(request.customer).toEqual({ kind: "existing", customerId: "cust" });
  });

  it("sends a normal window, and no charge for a fixed area", () => {
    const request = toCreateOrderRequest(
      draft({ fulfilmentType: "PICKUP_DELIVERY", areaChoice: "wuse", windowKey: "08:00-10:00", charge: "999", date: "2099-06-15" }),
      "request-id",
      areas,
    );
    expect(request.pickup).toMatchObject({ area: { kind: "area", areaId: "wuse" }, windowStart: "08:00", windowEnd: "10:00", charge: "" });
  });

  it("sends custom times outside the normal schedule, and the typed area outside the areas", () => {
    const request = toCreateOrderRequest(
      draft({
        fulfilmentType: "PICKUP_DELIVERY",
        areaChoice: OUT_OF_AREA,
        outOfAreaName: "Gwarinpa",
        outsideSchedule: true,
        windowKey: "08:00-10:00",
        customStart: "19:00",
        customEnd: "20:00",
        charge: "2,000",
      }),
      "request-id",
      areas,
    );
    expect(request.pickup).toMatchObject({
      area: { kind: "outOfArea", name: "Gwarinpa" },
      outsideSchedule: true,
      windowStart: "19:00",
      windowEnd: "20:00",
      charge: "2,000",
    });
  });
});

describe("reviewDraft", () => {
  it("totals lines, Others, and a fixed area's charge", () => {
    const review = reviewDraft(
      draft({
        channel: "PHONE",
        fulfilmentType: "PICKUP_DELIVERY",
        areaChoice: "wuse",
        serviceLines: [
          { key: "a", serviceId: "shirt", quantity: "3" },
          { key: "b", serviceId: "bedding", quantity: "2" },
        ],
        adjustments: [{ key: "c", description: "Loyalty", kind: "DISCOUNT", amount: "500" }],
      }),
      services,
      areas,
    );
    expect(review.total).toBe(240_000 + 500_000 - 50_000 + 150_000);
    expect(review.fullyPriced).toBe(true);
    expect(review.stage).toBe("PICKUP_SCHEDULED");
  });

  it("prices a quote-required line at its starting price once it has a quantity", () => {
    const review = reviewDraft(draft({ serviceLines: [{ key: "a", serviceId: "gown", quantity: "2" }] }), services, areas);
    expect(review.serviceLines[0]).toMatchObject({ lineTotal: 1_000_000 });
    expect(review.fullyPriced).toBe(true);
    expect(review.stage).toBe("RECEIVED_BY_STORE");
  });

  it("leaves a fractional quantity unpriced", () => {
    const review = reviewDraft(draft({ serviceLines: [{ key: "a", serviceId: "shirt", quantity: "1.5" }] }), services, areas);
    expect(review.serviceLines[0]).toMatchObject({ lineTotal: null });
  });

  it("waits for the charge on a quote-required area", () => {
    const pickup = draft({ fulfilmentType: "PICKUP_DELIVERY", areaChoice: "maitama", serviceLines: [{ key: "a", serviceId: "shirt", quantity: "1" }] });
    expect(reviewDraft(pickup, services, areas)).toMatchObject({ fulfilmentCharge: null, fullyPriced: false });
    expect(reviewDraft({ ...pickup, charge: "0" }, services, areas)).toMatchObject({ fulfilmentCharge: 0, fullyPriced: true });
  });
});
