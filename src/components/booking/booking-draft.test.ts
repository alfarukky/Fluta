import { describe, expect, it } from "vitest";

import { UNLISTED_AREA_ID } from "@/schemas/booking";
import type { BookingOptions } from "@/types/booking";

import {
  createDraft,
  EMPTY_DRAFT,
  fromServerErrors,
  getBookAndPayTotal,
  getSteps,
  isShortAddress,
  reviewBooking,
  toBookingRequest,
  validateStep,
  type BookingDraft,
} from "./booking-draft";

const OPTIONS: BookingOptions = {
  today: "2099-06-15",
  services: [
    { id: "shirt", name: "Shirt", category: null, pricingType: "PER_ITEM", price: 80_000, requiresQuote: false },
    { id: "bedding", name: "Bedding set", category: null, pricingType: "PER_PACKAGE", price: 250_000, requiresQuote: false },
    { id: "agbada", name: "Agbada", category: "Native", pricingType: "PER_ITEM", price: 500_000, requiresQuote: true },
    { id: "gown", name: "Wedding gown", category: "Specialist care", pricingType: "PER_ITEM", price: 0, requiresQuote: true },
  ],
  dropOff: true,
  payAtBooking: false,
  pickup: true,
  areas: [
    { id: "wuse", name: "Wuse 2", chargeType: "FIXED", fixedCharge: 150_000 },
    { id: "maitama", name: "Maitama", chargeType: "QUOTE_REQUIRED", fixedCharge: null },
  ],
  defaultFee: null,
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
  it("needs a service and a whole count from 1 to 999 for every service", () => {
    expect(validateStep("services", draft({}), OPTIONS)).toEqual({ services: "Choose at least one service" });
    expect(
      validateStep(
        "services",
        draft({
          lines: [
            { serviceId: "shirt", amount: "" },
            { serviceId: "bedding", amount: "0" },
            { serviceId: "agbada", amount: "1.5" },
          ],
        }),
        OPTIONS,
      ),
    ).toEqual({
      "service.shirt": "Enter how many",
      "service.bedding": "Enter at least 1",
      "service.agbada": "Enter a whole number",
    });
    expect(validateStep("services", draft({ lines: [{ serviceId: "bedding", amount: "1000" }] }), OPTIONS)).toEqual({
      "service.bedding": "Enter 999 or fewer",
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

  it("offers My area isn't listed only with a default fee, and needs the area's name", () => {
    const pickup = { areaId: UNLISTED_AREA_ID, address: "12 Test St", date: "2099-06-15", window: "10:00-12:00" };
    expect(validateStep("pickup", draft(pickup), OPTIONS)).toEqual({ areaId: "Choose your area" });
    const withFee = { ...OPTIONS, defaultFee: 0 };
    expect(validateStep("pickup", draft(pickup), withFee)).toEqual({ areaName: "Enter your area" });
    expect(validateStep("pickup", draft({ ...pickup, areaName: "K" }), withFee)).toEqual({
      areaName: "Area name must be 2 to 60 characters",
    });
    expect(validateStep("pickup", draft({ ...pickup, areaName: " Kubwa " }), withFee)).toEqual({});
  });

  it("allows an optional note of up to 300 characters", () => {
    const lines = [{ serviceId: "shirt", amount: "1" }];
    expect(validateStep("services", draft({ lines, note: "" }), OPTIONS)).toEqual({});
    expect(validateStep("services", draft({ lines, note: `  ${"a".repeat(300)}  ` }), OPTIONS)).toEqual({});
    expect(validateStep("services", draft({ lines, note: "a".repeat(301) }), OPTIONS)).toEqual({
      note: "Note must be 300 characters or fewer",
    });
  });

  it("never blocks Continue for a short address", () => {
    const pickup = { areaId: "wuse", date: "2099-06-15", window: "10:00-12:00" };
    expect(isShortAddress("Wuse 2")).toBe(true);
    expect(validateStep("pickup", draft({ ...pickup, address: "Wuse 2" }), OPTIONS)).toEqual({});
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
      customerNote: "",
    });
  });

  it("sends the note as typed (the server trims it and stores blank as none)", () => {
    expect(toBookingRequest(draft({ note: " 2 curtains, 1 rug " }), "id").customerNote).toBe(" 2 curtains, 1 rug ");
  });

  it("sends the typed area name only for an unlisted area, and a shared location", () => {
    const base = { fulfilmentType: "PICKUP_DELIVERY" as const, address: "12 Test St", date: "2099-06-15", window: "10:00-12:00" };
    const location = { latitude: 9.0765, longitude: 7.3986 };
    expect(toBookingRequest(draft({ ...base, areaId: UNLISTED_AREA_ID, areaName: "Kubwa", location }), "id").pickup).toEqual({
      areaId: UNLISTED_AREA_ID,
      areaName: "Kubwa",
      location,
      address: "12 Test St",
      date: "2099-06-15",
      windowStart: "10:00",
      windowEnd: "12:00",
    });
    const listed = toBookingRequest(draft({ ...base, areaId: "wuse", areaName: "Kubwa" }), "id").pickup;
    expect(listed).not.toHaveProperty("areaName");
    expect(listed).not.toHaveProperty("location");
  });

  it("sends no pickup details for a drop-off", () => {
    expect(toBookingRequest(draft({ fulfilmentType: "DROP_OFF", areaId: "wuse", window: "10:00-12:00" }), "id").pickup).toBeNull();
  });
});

describe("isShortAddress", () => {
  it("warns under 20 characters", () => {
    expect(isShortAddress("12 Aminu Kano Cres")).toBe(true); // 18 characters, 4 words
    expect(isShortAddress("12 Aminu Kano Cresc.")).toBe(false); // 20 characters
    expect(isShortAddress("   12 Aminu Kano Cres   ")).toBe(true); // spaces around don't count
  });

  it("warns with fewer than three words", () => {
    expect(isShortAddress("Plot1234AdmiraltyWay")).toBe(true);
    expect(isShortAddress("Plot 1234AdmiraltyWayLekki")).toBe(true);
    expect(isShortAddress("12 Admiralty Way, Lekki Phase 1, near Mega Plaza")).toBe(false);
    expect(isShortAddress("12,Admiralty,WayLekkiPhase")).toBe(false); // commas separate words
  });

  it("says nothing about an empty address (that's the required-field error)", () => {
    expect(isShortAddress("")).toBe(false);
    expect(isShortAddress("   ")).toBe(false);
  });
});

describe("fromServerErrors", () => {
  it("maps the server's note error to the note field", () => {
    expect(fromServerErrors({ customerNote: "Note must be 300 characters or fewer" }, draft({}))).toEqual({
      note: "Note must be 300 characters or fewer",
    });
  });

  it("maps the server's fields onto this form's", () => {
    const lines = [
      { serviceId: "shirt", amount: "3" },
      { serviceId: "bedding", amount: "0" },
    ];
    expect(
      fromServerErrors(
        {
          "serviceLines.1.quantity": "Enter at least 1",
          "pickup.window": "That pickup time is no longer available. Please choose another.",
          "pickup.areaId": "This area isn't available any more. Choose another.",
          "customer.phone": "Enter a valid phone number",
        },
        draft({ lines }),
      ),
    ).toEqual({
      "service.bedding": "Enter at least 1",
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
      { serviceId: "shirt", name: "Shirt", amount: 3, isEstimate: false, lineTotal: 240_000 },
      { serviceId: "agbada", name: "Agbada", amount: 2, isEstimate: true, lineTotal: null },
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

  it("charges the default fee for an unlisted area, ₦0 included", () => {
    const lines = [{ serviceId: "shirt", amount: "1" }];
    const unlisted = draft({ lines, fulfilmentType: "PICKUP_DELIVERY", areaId: UNLISTED_AREA_ID, areaName: "Kubwa" });
    expect(reviewBooking(unlisted, { ...OPTIONS, defaultFee: 200_000 }).pickupCharge).toBe(200_000);
    const free = reviewBooking(unlisted, { ...OPTIONS, defaultFee: 0 });
    expect(free.pickupCharge).toBe(0);
    expect(free.summary).toEqual({ kind: "total", total: 80_000 });
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

describe("Book and pay", () => {
  const PAY_AT_BOOKING = { ...OPTIONS, payAtBooking: true };
  const shirts = draft({ lines: [{ serviceId: "shirt", amount: "3" }], fulfilmentType: "DROP_OFF", name: "Ada Obi", phone: "0803 123 4567" });

  it("applies to a fixed-price booking at a store that takes payment at booking", () => {
    expect(getBookAndPayTotal(PAY_AT_BOOKING, reviewBooking(shirts, PAY_AT_BOOKING))).toBe(240_000);
  });

  it("never applies when the store doesn't take payment at booking", () => {
    expect(getBookAndPayTotal(OPTIONS, reviewBooking(shirts, OPTIONS))).toBeNull();
  });

  it("never applies while the store still has to confirm a price", () => {
    const estimate = draft({ ...shirts, lines: [{ serviceId: "agbada", amount: "2" }] });
    expect(getBookAndPayTotal(PAY_AT_BOOKING, reviewBooking(estimate, PAY_AT_BOOKING))).toBeNull();
    const quotedArea = draft({ ...shirts, fulfilmentType: "PICKUP_DELIVERY", areaId: "maitama" });
    expect(getBookAndPayTotal(PAY_AT_BOOKING, reviewBooking(quotedArea, PAY_AT_BOOKING))).toBeNull();
  });

  it("requires the email only on the Book and pay path", () => {
    expect(validateStep("details", shirts, PAY_AT_BOOKING)).toEqual({ email: "Enter your email for your Paystack receipt" });
    expect(validateStep("details", draft({ ...shirts, email: "ada@example.com" }), PAY_AT_BOOKING)).toEqual({});
    expect(validateStep("details", shirts, OPTIONS)).toEqual({});
  });
});
