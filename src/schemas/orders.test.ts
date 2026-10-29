import { describe, expect, it } from "vitest";

import { createOrderSchema, type CreateOrderRequest } from "./orders";

const dropOff: CreateOrderRequest = {
  clientRequestId: "3f6c2a8e-5b1d-4c7e-9a2f-1d8b6e4c0a91",
  customer: { kind: "new", name: " Tunde Bakare ", phone: "0803 123 4521", email: "" },
  channel: "COUNTER",
  fulfilmentType: "DROP_OFF",
  pickup: null,
  serviceLines: [{ serviceId: "svc_shirt", quantity: "3" }],
  adjustments: [],
  internalNote: "  ",
};

const pickup = {
  area: { kind: "outOfArea" as const, name: "Gwarinpa" },
  address: "12 Ahmadu Bello Way",
  date: "2099-06-21",
  outsideSchedule: false,
  windowStart: "08:00",
  windowEnd: "10:00",
  charge: "2,000",
};

describe("createOrderSchema", () => {
  // The first message for each field is the one shown beneath it.
  const firstMessage = (request: CreateOrderRequest, path: string) =>
    createOrderSchema.safeParse(request).error?.issues.find((issue) => issue.path.join(".") === path)?.message;

  it("asks for a customer, a name, and a phone number in plain words", () => {
    expect(firstMessage({ ...dropOff, customer: { kind: "existing", customerId: "" } }, "customer.customerId")).toBe(
      "Choose a customer, or add a new one",
    );
    const blank = { kind: "new" as const, name: " ", phone: "", email: "" };
    expect(firstMessage({ ...dropOff, customer: blank }, "customer.name")).toBe("Enter the customer's name");
    expect(firstMessage({ ...dropOff, customer: blank }, "customer.phone")).toBe("Enter the customer's phone number");
  });

  it("asks for a pickup window in plain words", () => {
    const noWindow = { ...dropOff, fulfilmentType: "PICKUP_DELIVERY" as const, pickup: { ...pickup, windowStart: "", windowEnd: "" } };
    expect(firstMessage(noWindow, "pickup.windowStart")).toBe("Choose a pickup window");
  });

  it("parses a counter drop-off: trimmed name, E.164 phone, whole quantity, blank note as null", () => {
    const order = createOrderSchema.parse(dropOff);
    expect(order.customer).toEqual({ kind: "new", name: "Tunde Bakare", phone: "+2348031234521", email: null });
    expect(order.serviceLines).toEqual([{ serviceId: "svc_shirt", quantity: 3 }]);
    expect(order.internalNote).toBeNull();
  });

  it("refuses a fractional quantity", () => {
    for (const quantity of ["1.5", "2.0", "0.5"]) {
      const result = createOrderSchema.safeParse({ ...dropOff, serviceLines: [{ serviceId: "svc_shirt", quantity }] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe("Enter a whole number, like 3");
    }
  });

  it("requires a UUID request ID", () => {
    for (const clientRequestId of [undefined, "", "not-a-uuid"]) {
      const result = createOrderSchema.safeParse({ ...dropOff, clientRequestId });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(["clientRequestId"]);
    }
  });

  it("ignores prices sent by the browser", () => {
    const order = createOrderSchema.parse({
      ...dropOff,
      serviceLines: [{ serviceId: "svc_shirt", quantity: "3", unitPrice: 1, lineTotal: 1 }],
      total: 1,
    });
    expect(order.serviceLines[0]).toEqual({ serviceId: "svc_shirt", quantity: 3 });
    expect(order).not.toHaveProperty("total");
  });

  it("stores a discount as a negative amount", () => {
    const order = createOrderSchema.parse({
      ...dropOff,
      adjustments: [
        { description: "Loyalty", kind: "DISCOUNT", amount: "500" },
        { description: "Express", kind: "CHARGE", amount: "1,000.50" },
      ],
    });
    expect(order.adjustments).toEqual([
      { description: "Loyalty", amount: -50_000 },
      { description: "Express", amount: 100_050 },
    ]);
  });

  it("refuses a zero adjustment and one without a description", () => {
    expect(createOrderSchema.safeParse({ ...dropOff, adjustments: [{ description: "x", kind: "CHARGE", amount: "0" }] }).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...dropOff, adjustments: [{ description: " ", kind: "CHARGE", amount: "5" }] }).success).toBe(false);
  });

  it("only accepts staff channels", () => {
    expect(createOrderSchema.safeParse({ ...dropOff, channel: "ONLINE" }).success).toBe(false);
  });

  it("drops pickup details from a drop-off order", () => {
    expect(createOrderSchema.parse({ ...dropOff, pickup }).pickup).toBeNull();
  });

  it("needs pickup details, and an agreed charge outside the service areas", () => {
    const base = { ...dropOff, fulfilmentType: "PICKUP_DELIVERY" as const };
    expect(createOrderSchema.safeParse(base).error?.issues[0].path).toEqual(["pickup"]);
    expect(createOrderSchema.parse({ ...base, pickup }).pickup?.charge).toBe(200_000);
    expect(createOrderSchema.parse({ ...base, pickup: { ...pickup, charge: "0" } }).pickup?.charge).toBe(0);
    expect(createOrderSchema.safeParse({ ...base, pickup: { ...pickup, charge: "" } }).error?.issues[0].path).toEqual([
      "pickup",
      "charge",
    ]);
  });

  it("needs a note for a pickup outside the normal schedule", () => {
    const base = { ...dropOff, fulfilmentType: "PICKUP_DELIVERY" as const, pickup: { ...pickup, outsideSchedule: true } };
    expect(createOrderSchema.safeParse(base).error?.issues[0].path).toEqual(["internalNote"]);
    expect(createOrderSchema.safeParse({ ...base, internalNote: "Customer agreed Sunday 7 PM" }).success).toBe(true);
  });
});
