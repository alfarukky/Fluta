import { describe, expect, it } from "vitest";

import {
  describeChangedRefundOwed,
  describeRefundRecorded,
  describeRefundTooLarge,
  describeRefundVoided,
  getRefundableKobo,
  REFUND_METHODS,
} from "./refunds";

describe("getRefundableKobo", () => {
  it("is what the store owes the customer: the balance below 0, as a positive amount", () => {
    expect(getRefundableKobo(-300_000)).toBe(300_000);
  });

  it("is 0 when nothing is owed back, or no price is approved yet", () => {
    expect(getRefundableKobo(0)).toBe(0);
    expect(getRefundableKobo(250_000)).toBe(0);
    expect(getRefundableKobo(null)).toBe(0);
  });
});

describe("refund wording", () => {
  it("states the limit and the changed amount owed", () => {
    expect(describeRefundTooLarge(300_000)).toBe("The refund can't be more than the ₦3,000 owed");
    expect(describeChangedRefundOwed(300_000)).toBe("The amount owed has changed. ₦3,000 is now owed.");
  });

  it("describes timeline entries with the method and who did it", () => {
    expect(describeRefundRecorded({ amount: 300_000, method: "BANK_TRANSFER" }, "Ada")).toBe(
      "Refund recorded: ₦3,000 by transfer, by Ada",
    );
    expect(describeRefundRecorded({ amount: 50_000, method: "CASH" }, null)).toBe("Refund recorded: ₦500 in cash, by Staff");
    expect(describeRefundVoided({ amount: 300_000, method: "POS" }, "Kemi")).toBe("Refund voided: ₦3,000 by POS, by Kemi");
  });

  it("never offers Paystack as a way to pay a refund back", () => {
    expect(REFUND_METHODS).toEqual(["CASH", "BANK_TRANSFER", "POS", "OTHER"]);
  });
});
