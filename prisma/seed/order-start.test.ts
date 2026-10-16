import { describe, expect, it } from "vitest";

import { getSeedStartProblem } from "./order-start";

describe("getSeedStartProblem", () => {
  it("accepts histories that start where order entry starts them", () => {
    expect(getSeedStartProblem({ channel: "ONLINE", fulfilmentType: "PICKUP_DELIVERY", stages: ["BOOKED", "PICKUP_SCHEDULED"] })).toBeNull();
    expect(getSeedStartProblem({ channel: "COUNTER", fulfilmentType: "DROP_OFF", stages: ["RECEIVED_BY_STORE"] })).toBeNull();
    expect(getSeedStartProblem({ channel: "PHONE", fulfilmentType: "DROP_OFF", stages: ["BOOKED", "RECEIVED_BY_STORE"] })).toBeNull();
    expect(getSeedStartProblem({ channel: "PHONE", fulfilmentType: "PICKUP_DELIVERY", stages: ["PICKUP_SCHEDULED", "PICKED_UP"] })).toBeNull();
  });

  it("refuses a staff-entered pickup order that starts at Booked", () => {
    expect(getSeedStartProblem({ channel: "PHONE", fulfilmentType: "PICKUP_DELIVERY", stages: ["BOOKED", "PICKUP_SCHEDULED"] })).toBe(
      "Seed data: a PHONE PICKUP_DELIVERY order starts at PICKUP_SCHEDULED, not BOOKED.",
    );
  });

  it("refuses an empty history", () => {
    expect(getSeedStartProblem({ channel: "ONLINE", fulfilmentType: "DROP_OFF", stages: [] })).toMatch(/not nothing/);
  });
});
