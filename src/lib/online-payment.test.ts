import { describe, expect, it } from "vitest";

import { getPaymentWarning, getTransferWarning } from "./online-payment";

describe("payment warnings", () => {
  it("names the store and never asks for a transfer", () => {
    expect(getTransferWarning("FreshFold Laundry")).toBe(
      "FreshFold Laundry will never ask you to transfer money to a personal account.",
    );
    expect(getPaymentWarning("FreshFold Laundry")).toBe(
      "You'll pay on Paystack's secure page. FreshFold Laundry will never ask you to transfer money to a personal account.",
    );
  });
});
