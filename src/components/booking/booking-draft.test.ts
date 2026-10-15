import { describe, expect, it } from "vitest";

import type { BookingOptions } from "@/types/booking";

import {
  createDraft,
  EMPTY_DRAFT,
  fromServerErrors,
  getSteps,
  reviewBooking,
  toBookingRequest,
  validateStep,
  type BookingDraft,
} from "./booking-draft";

const OPTIONS: BookingOptions = {
  today: "2099-06-15",
  services: [
    { id: "shirt", name: "Shirt", category: null, pricingType: "PER_ITEM", price: 80_000, requiresQuote: false },
    { id: "wash", name: "Wash & fold", category: null, pricingType: "PER_KG", price: 150_000, requiresQuote: true },
    { id: "agbada", name: "Agbada", category: "Native", pricingType: "PER_ITEM", price: 500_000, requiresQuote: true },
    { id: "gown", name: "Wedding gown", category: "Specialist care", pricingType: "PER_ITEM", price: 0, requiresQuote: true },
  ],
  dropOff: true,
  pickup: true,
  areas: [
    { id: "wuse", name: "Wuse 2", chargeType: "FIXED", fixedCharge: 150_000 },
    { id: "maitama", name: "Maitama", chargeType: "QUOTE_REQUIRED", fixedCharge: null },
  ],
  dates: [{ date: "2099-06-15", windows: [{ start: "10:00", end: "12:00" }] }],
};

const draft = (patch: Partial<BookingDraft>): BookingDraft => ({ ...EMPTY_DRAFT, ...patch });

describe("createDraft", () => {
  it("chooses the only way the store offers", () => {
    expect(createDraft({ dropOff: true, pickup: false }).fulfilmentType).toBe("DROP_OFF");
    expect(createDraft({ dropOff: false, pickup: true }).fulfilmentType).toBe("PICKUP_DELIVERY");
    expect(createDraft({ dropOff: true, pickup: true }).fulfilmentType).toBeNull();
  });
});

describe("getSteps", () => {
  it("asks for pickup details only for a pickup", () => {
    expect(getSteps({ fulfilmentType: "DROP_OFF" })).toEqual(["services", "fulfilment", "details", "review"]);
    expect(getSteps({ fulfilmentType: "PICKUP_DELIVERY" })).toContain("pickup");
  });
});

describe("validateStep", () => {
  it("needs a service, a count for items, and a sensible weight", () => {
    expect(validateStep("services", draft({}), OPTIONS)).toEqual({ services: "Choose at least one service" });
    expect(
      validateStep(
        "services",
        draft({
          lines: [
            { serviceId: "shirt", amount: "" },
            { serviceId: "wash", amount: "" },
            { serviceId: "agbada", amount: "1.5" },
          ],
        }),
        OPTIONS,
      ),
    ).toEqual({ "service.shirt": "Enter how many", "service.agbada": "Enter a whole number" });
    expect(validateStep("services", draft({ lines: [{ serviceId: "wash", amount: "0.05" }] }), OPTIONS)).toEqual({
      "service.wash": "Enter at least 0.1 kg",
    });
  });

  it("needs an offered area, date, and time for a pickup", () => {
    expect(validateStep("pickup", draft({ fulfilmentType: "PICKUP_DELIVERY" }), OPTIONS)).toEqual({
      areaId: "Choose your area",
      address: "Enter your address",
      date: "Choose a pickup date",
    });
    expect(
      validateStep(
        "pickup",
        draft({ areaId: "wuse", address: "12 Test St", date: "2099-06-15", window: "08:00-10:00" }),
        OPTIONS,
      ),
    ).toEqual({ window: "Choose a pickup time" });
  });

  it("checks the name, phone, and optional email", () => {
    expect(validateStep("details", draft({ name: "A", phone: "", email: "nope" }), OPTIONS)).toEqual({
      name: "Name must be at least 2 characters",
      phone: "Enter your phone number",
      email: "Enter a valid email address",
    });
    expect(validateStep("details", draft({ name: "Ada Obi", phone: "0803 123 4567", email: "" }), OPTIONS)).toEqual({});
  });
});

describe("toBookingRequest", () => {
  it("sends IDs, amounts, choices, and contact details only", () => {
    const request = toBookingRequest(
      draft({
        lines: [{ serviceId: "shirt", amount: "3" }],
        fulfilmentType: "PICKUP_DELIVERY",
        areaId: "wuse",
        address: "12 Test St",
        date: "2099-06-15",
        window: "10:00-12:00",
        name: "Ada",
        phone: "0803",
        email: "",
      }),
      "id-1",
    );
    expect(request).toEqual({
      clientRequestId: "id-1",
      serviceLines: [{ serviceId: "shirt", amount: "3" }],
      fulfilmentType: "PICKUP_DELIVERY",
      pickup: { areaId: "wuse", address: "12 Test St", date: "2099-06-15", windowStart: "10:00", windowEnd: "12:00" },
      customer: { name: "Ada", phone: "0803", email: "" },
    });
  });

  it("sends no pickup details for a drop-off", () => {
    expect(toBookingRequest(draft({ fulfilmentType: "DROP_OFF", areaId: "wuse", window: "10:00-12:00" }), "id").pickup).toBeNull();
  });
});

describe("fromServerErrors", () => {
  it("maps the server's fields onto this form's", () => {
    const lines = [
      { serviceId: "shirt", amount: "3" },
      { serviceId: "wash", amount: "" },
    ];
    expect(
      fromServerErrors(
        {
          "serviceLines.1.quantity": "Enter at least 0.1 kg",
          "pickup.window": "That pickup time is no longer available. Please choose another.",
          "pickup.areaId": "This area isn't available any more. Choose another.",
          "customer.phone": "Enter a valid phone number",
        },
        draft({ lines }),
      ),
    ).toEqual({
      "service.wash": "Enter at least 0.1 kg",
      window: "That pickup time is no longer available. Please choose another.",
      areaId: "This area isn't available any more. Choose another.",
      phone: "Enter a valid phone number",
    });
  });
});

describe("reviewBooking", () => {
  it("prices fixed items, and keeps estimates and a confirmed charge unpriced", () => {
    const review = reviewBooking(
      draft({
        lines: [
          { serviceId: "shirt", amount: "3" },
          { serviceId: "agbada", amount: "2" },
        ],
        fulfilmentType: "PICKUP_DELIVERY",
        areaId: "wuse",
      }),
      OPTIONS,
    );
    expect(review.lines).toEqual([
      { serviceId: "shirt", name: "Shirt", amount: 300, isEstimate: false, lineTotal: 240_000 },
      { serviceId: "agbada", name: "Agbada", amount: 200, isEstimate: true, lineTotal: null },
    ]);
    expect(review.pickupCharge).toBe(150_000);
    expect(review.summary).toEqual({ kind: "estimate", total: 240_000 + 1_000_000 + 150_000 });
  });

  it("gives no number when an item is priced on inspection", () => {
    const review = reviewBooking(
      draft({
        lines: [
          { serviceId: "agbada", amount: "2" },
          { serviceId: "gown", amount: "1" },
        ],
        fulfilmentType: "DROP_OFF",
      }),
      OPTIONS,
    );
    expect(review.summary).toEqual({ kind: "unknown" });
  });

  it("gives no number when the store will confirm the pickup charge", () => {
    const review = reviewBooking(
      draft({ lines: [{ serviceId: "shirt", amount: "1" }], fulfilmentType: "PICKUP_DELIVERY", areaId: "maitama" }),
      OPTIONS,
    );
    expect(review.pickupCharge).toBeNull();
    expect(review.summary).toEqual({ kind: "unknown" });
  });
});
