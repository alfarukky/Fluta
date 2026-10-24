import { describe, expect, it } from "vitest";

import { changeAccountSchema, connectAccountSchema, settlementAccountSchema, startPaymentSchema } from "./online-payments";

describe("settlementAccountSchema", () => {
  it("accepts a bank code and a 10-digit account number, ignoring spaces and dashes", () => {
    expect(settlementAccountSchema.parse({ bankId: " 9 ", accountNumber: "0123 45-4521" })).toEqual({
      bankId: "9",
      accountNumber: "0123454521",
    });
  });

  it.each(["012345452", "01234545211", "01234x4521", ""])("refuses the account number %j", (accountNumber) => {
    const result = settlementAccountSchema.safeParse({ bankId: "9", accountNumber });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["accountNumber"], message: "Enter your 10-digit account number" });
  });

  it.each(["", "9 1", "058a", "../x"])("refuses the bank id %j", (bankId) => {
    expect(settlementAccountSchema.safeParse({ bankId, accountNumber: "0123454521" }).error?.issues[0].path).toEqual(["bankId"]);
  });
});

describe("connectAccountSchema and changeAccountSchema", () => {
  const account = { bankId: "9", accountNumber: "0123454521", accountName: " AMINA BELLO " };

  it("connect needs a business name and the confirmed account name", () => {
    expect(connectAccountSchema.parse({ ...account, businessName: " FreshFold Laundry " })).toMatchObject({
      businessName: "FreshFold Laundry",
      accountName: "AMINA BELLO",
    });
    expect(connectAccountSchema.safeParse({ ...account, businessName: "F" }).success).toBe(false);
    expect(connectAccountSchema.safeParse({ ...account, businessName: "FreshFold", accountName: "" }).error?.issues[0].path).toEqual([
      "accountName",
    ]);
  });

  it("change needs the password, kept exactly as typed", () => {
    expect(changeAccountSchema.parse({ ...account, password: " secret " }).password).toBe(" secret ");
    expect(changeAccountSchema.safeParse({ ...account, password: "" }).error?.issues[0]).toMatchObject({
      path: ["password"],
      message: "Enter your password",
    });
  });
});

describe("startPaymentSchema", () => {
  it("normalizes the payer's email", () => {
    expect(startPaymentSchema.parse({ email: "  Amina@Example.COM " })).toEqual({ email: "amina@example.com" });
  });

  it("requires an email, for the Paystack receipt", () => {
    expect(startPaymentSchema.safeParse({ email: "  " }).error?.issues[0].message).toBe("Enter your email for your Paystack receipt");
  });

  it.each(["amina", "amina@", "a@b"])("refuses %j", (email) => {
    expect(startPaymentSchema.safeParse({ email }).error?.issues[0].message).toBe("Enter a valid email address");
  });
});
