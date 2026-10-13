import { describe, expect, it } from "vitest";

import { FulfilmentType, OrderChannel } from "@/generated/prisma/enums";

import {
  formatOrderNumber,
  getActorLabel,
  getInitialStage,
  getQuoteRevisionLabel,
  getTimelineLabel,
  isAwaitingApproval,
  parseOrderNumberSearch,
  summarizeServices,
} from "./orders";

describe("formatOrderNumber", () => {
  it("joins the store's prefix and the number", () => {
    expect(formatOrderNumber({ orderPrefix: "FF" }, 1024)).toBe("FF-1024");
    expect(formatOrderNumber({ orderPrefix: "CWL" }, 1001)).toBe("CWL-1001");
  });
});

describe("getInitialStage", () => {
  const expected: Record<OrderChannel, Record<FulfilmentType, string>> = {
    COUNTER: { DROP_OFF: "RECEIVED_BY_STORE", PICKUP_DELIVERY: "PICKUP_SCHEDULED" },
    PHONE: { DROP_OFF: "BOOKED", PICKUP_DELIVERY: "PICKUP_SCHEDULED" },
    WHATSAPP: { DROP_OFF: "BOOKED", PICKUP_DELIVERY: "PICKUP_SCHEDULED" },
    ONLINE: { DROP_OFF: "BOOKED", PICKUP_DELIVERY: "BOOKED" },
  };

  for (const channel of Object.values(OrderChannel)) {
    for (const fulfilment of Object.values(FulfilmentType)) {
      it(`starts a ${channel} ${fulfilment} order at ${expected[channel][fulfilment]}`, () => {
        expect(getInitialStage(channel, fulfilment)).toBe(expected[channel][fulfilment]);
      });
    }
  }
});

describe("parseOrderNumberSearch", () => {
  it.each(["1024", "FF-1024", "ff1024", " ff - 1024 ", "FF 1024"])("reads %j as FreshFold's order 1024", (text) => {
    expect(parseOrderNumberSearch(text, "FF")).toBe(1024);
  });

  it("matches no number when the letters aren't the store's prefix", () => {
    expect(parseOrderNumberSearch("CW1024", "FF")).toBeNull();
    expect(parseOrderNumberSearch("CW-1024", "FF")).toBeNull();
  });

  it.each(["ABC", "12.5", "FF-", "1024FF", "", "08031234567"])("isn't an order number: %j", (text) => {
    expect(parseOrderNumberSearch(text, "FF")).toBeNull();
  });
});

describe("summarizeServices", () => {
  it("shows the first two lines and how many more", () => {
    expect(
      summarizeServices([
        { description: "Shirt", pricingType: "PER_ITEM", quantity: 400 },
        { description: "Trousers", pricingType: "PER_ITEM", quantity: 200 },
        { description: "Duvet", pricingType: "PER_ITEM", quantity: 100 },
        { description: "Bedsheet", pricingType: "PER_PACKAGE", quantity: 100 },
      ]),
    ).toBe("Shirt × 4, Trousers × 2 +2 more");
  });

  it("shows weights in kg and an unweighed line by name", () => {
    expect(
      summarizeServices([
        { description: "Laundry by weight", pricingType: "PER_KG", quantity: 350 },
        { description: "Wash & fold", pricingType: "PER_KG", quantity: null },
      ]),
    ).toBe("Laundry by weight 3.5 kg, Wash & fold");
  });

  it("is empty for an order with no service lines", () => {
    expect(summarizeServices([])).toBe("");
  });
});

describe("getQuoteRevisionLabel", () => {
  const at = new Date("2026-10-12T09:00:00Z");

  it("labels a version 1 that was never approved or declined as an Estimate", () => {
    expect(getQuoteRevisionLabel({ version: 1, status: "PENDING", approvedAt: null, declinedAt: null })).toBe("Estimate");
    expect(getQuoteRevisionLabel({ version: 1, status: "SUPERSEDED", approvedAt: null, declinedAt: null })).toBe(
      "Estimate",
    );
  });

  it("uses the status otherwise", () => {
    expect(getQuoteRevisionLabel({ version: 1, status: "APPROVED", approvedAt: at, declinedAt: null })).toBe("Approved");
    expect(getQuoteRevisionLabel({ version: 2, status: "PENDING", approvedAt: null, declinedAt: null })).toBe(
      "Awaiting approval",
    );
    expect(getQuoteRevisionLabel({ version: 2, status: "DECLINED", approvedAt: null, declinedAt: at })).toBe("Declined");
  });
});

describe("getActorLabel", () => {
  it("names staff, and falls back when the name isn't known", () => {
    expect(getActorLabel("STAFF", "Chidi Okafor")).toBe("Chidi Okafor");
    expect(getActorLabel("STAFF", null)).toBe("Staff");
  });

  it("labels customers and the system", () => {
    expect(getActorLabel("CUSTOMER", null)).toBe("Customer");
    expect(getActorLabel("SYSTEM", null)).toBe("System");
  });
});

describe("getTimelineLabel", () => {
  it("labels a pickup order completed from Ready as collected by the customer", () => {
    expect(getTimelineLabel({ fromStage: "READY", toStage: "COMPLETED" }, "PICKUP_DELIVERY")).toBe(
      "Completed: collected by customer",
    );
  });

  it("uses the stage name otherwise", () => {
    expect(getTimelineLabel({ fromStage: "OUT_FOR_DELIVERY", toStage: "COMPLETED" }, "PICKUP_DELIVERY")).toBe("Completed");
    expect(getTimelineLabel({ fromStage: "READY", toStage: "COMPLETED" }, "DROP_OFF")).toBe("Completed");
    expect(getTimelineLabel({ fromStage: null, toStage: "BOOKED" }, "DROP_OFF")).toBe("Booked");
  });
});

describe("isAwaitingApproval", () => {
  const revision = { approvedAt: null, declinedAt: null };

  it("is true for a sent revision still pending", () => {
    expect(isAwaitingApproval({ ...revision, version: 2, status: "PENDING" })).toBe(true);
  });

  it("is false for an estimate, or anything already decided", () => {
    expect(isAwaitingApproval({ ...revision, version: 1, status: "PENDING" })).toBe(false);
    expect(isAwaitingApproval({ ...revision, version: 2, status: "SUPERSEDED" })).toBe(false);
    expect(isAwaitingApproval({ version: 2, status: "APPROVED", approvedAt: new Date(), declinedAt: null })).toBe(false);
  });
});
