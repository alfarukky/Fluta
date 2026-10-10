import { describe, expect, it } from "vitest";

import type { OrderEntryArea, OrderEntryService } from "@/types/orders";

import { addService, emptyDraft, OUT_OF_AREA, reviewDraft, toCreateOrderRequest, type OrderDraft } from "./order-draft";

const shirt: OrderEntryService = { id: "shirt", name: "Shirt", category: "Ironing", pricingType: "PER_ITEM", price: 80_000, requiresQuote: false };
const wash: OrderEntryService = { id: "wash", name: "Wash & fold", category: "Washing", pricingType: "PER_KG", price: 150_000, requiresQuote: true };
const services = [shirt, wash];
const areas: OrderEntryArea[] = [
  { id: "wuse", name: "Wuse 2", chargeType: "FIXED", fixedCharge: 150_000 },
  { id: "maitama", name: "Maitama", chargeType: "QUOTE_REQUIRED", fixedCharge: null },
];

function draft(change: Partial<OrderDraft> = {}): OrderDraft {
  return { ...emptyDraft("DROP_OFF"), ...change };
}

describe("addService", () => {
  it("adds a new item line with a quantity of 1, and a weighed line empty", () => {
    const withShirt = addService([], shirt, "a");
    expect(withShirt).toEqual({ lines: [{ key: "a", serviceId: "shirt", quantity: "1", estimate: "" }], combined: false });
    expect(addService([], wash, "b").lines[0].quantity).toBe("");
  });

  it("adds to an item already on the order", () => {
    const lines = [{ key: "a", serviceId: "shirt", quantity: "2", estimate: "" }];
    expect(addService(lines, shirt, "b")).toEqual({
      lines: [{ key: "a", serviceId: "shirt", quantity: "3", estimate: "" }],
      combined: true,
    });
  });

  it("leaves a weighed line already on the order as it is", () => {
    const lines = [{ key: "a", serviceId: "wash", quantity: "2.5", estimate: "" }];
    expect(addService(lines, wash, "b")).toEqual({ lines, combined: true });
  });
});

describe("toCreateOrderRequest", () => {
  it("sends an existing customer by ID, and only services and quantities", () => {
    const request = toCreateOrderRequest(
      draft({
        selectedCustomer: { id: "cust", name: "Amaka", phone: "+234 803 123 4521", email: null },
        serviceLines: [{ key: "a", serviceId: "shirt", quantity: "2", estimate: "" }],
      }),
      "request-id",
      areas,
    );
    expect(request.customer).toEqual({ kind: "existing", customerId: "cust" });
    expect(request.serviceLines).toEqual([{ serviceId: "shirt", quantity: "2", estimate: "" }]);
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
          { key: "a", serviceId: "shirt", quantity: "3", estimate: "" },
          { key: "b", serviceId: "wash", quantity: "2.5", estimate: "" },
        ],
        adjustments: [{ key: "c", description: "Loyalty", kind: "DISCOUNT", amount: "500" }],
      }),
      services,
      areas,
    );
    expect(review.total).toBe(240_000 + 375_000 - 50_000 + 150_000);
    expect(review.fullyPriced).toBe(true);
    expect(review.stage).toBe("PICKUP_SCHEDULED");
  });

  it("shows an unweighed line as awaiting weight and the total as an estimate", () => {
    const review = reviewDraft(draft({ serviceLines: [{ key: "a", serviceId: "wash", quantity: "", estimate: "3" }] }), services, areas);
    expect(review.serviceLines[0]).toMatchObject({ lineTotal: null, awaitingWeight: true });
    expect(review.fullyPriced).toBe(false);
    expect(review.stage).toBe("RECEIVED_BY_STORE");
  });

  it("waits for the charge on a quote-required area", () => {
    const pickup = draft({ fulfilmentType: "PICKUP_DELIVERY", areaChoice: "maitama", serviceLines: [{ key: "a", serviceId: "shirt", quantity: "1", estimate: "" }] });
    expect(reviewDraft(pickup, services, areas)).toMatchObject({ fulfilmentCharge: null, fullyPriced: false });
    expect(reviewDraft({ ...pickup, charge: "0" }, services, areas)).toMatchObject({ fulfilmentCharge: 0, fullyPriced: true });
  });
});
