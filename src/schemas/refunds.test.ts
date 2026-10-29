import { describe, expect, it } from "vitest";

import { recordRefundSchema, voidRefundSchema } from "./refunds";

const base = {
  orderId: "order_1",
  clientRequestId: "6f1c7a64-3b0e-4f43-9a52-4b2f1f0c9d11",
  amount: "3,000",
  method: "BANK_TRANSFER",
  reference: "",
  note: "Order cancelled, refunded by transfer",
};

describe("recordRefundSchema", () => {
  it("reads the amount in kobo and stores a blank reference as null", () => {
    expect(recordRefundSchema.parse(base)).toMatchObject({ amount: 300_000, reference: null, note: base.note });
  });

  it("requires an amount above ₦0", () => {
    const issue = (amount: string) => recordRefundSchema.safeParse({ ...base, amount }).error?.issues[0]?.message;
    expect(issue("")).toBe("Enter the amount refunded");
    expect(issue("0")).toBe("Enter an amount above ₦0");
  });

  it("requires a note of up to 200 characters, and a reference of up to 100", () => {
    expect(recordRefundSchema.safeParse({ ...base, note: "  " }).error?.issues[0]?.message).toBe("Add a note about this refund");
    expect(recordRefundSchema.safeParse({ ...base, note: "x".repeat(201) }).success).toBe(false);
    expect(recordRefundSchema.safeParse({ ...base, reference: "x".repeat(101) }).success).toBe(false);
  });

  it("refuses Paystack as a method", () => {
    expect(recordRefundSchema.safeParse({ ...base, method: "PAYSTACK" }).success).toBe(false);
  });
});

describe("voidRefundSchema", () => {
  it("requires a reason", () => {
    const result = voidRefundSchema.safeParse({ mode: "VOID_ONLY", refundId: "refund_1", reason: " " });
    expect(result.error?.issues[0]?.message).toBe("Add a reason for voiding this refund");
  });

  it("takes the correct refund's details and request ID when replacing", () => {
    const { clientRequestId, amount, method, reference, note } = base;
    const details = { clientRequestId, amount, method, reference, note };
    expect(voidRefundSchema.parse({ mode: "REPLACE", refundId: "refund_1", reason: "Wrong amount", ...details })).toMatchObject({
      mode: "REPLACE",
      amount: 300_000,
    });
  });
});
