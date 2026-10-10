import { describe, expect, it } from "vitest";

import { FulfilmentType, OrderChannel } from "@/generated/prisma/enums";

import { formatOrderNumber, getInitialStage } from "./orders";

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
