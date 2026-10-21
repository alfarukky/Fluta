import { afterEach, describe, expect, it, vi } from "vitest";

import { logger, redactTrackingTokens } from "./logger";

const TOKEN = "Zm9vYmFyYmF6cXV4LXRva2VuLWZvci10ZXN0aW5nLTE";

describe("redactTrackingTokens", () => {
  it("replaces the token in a tracking path, wherever it appears", () => {
    expect(redactTrackingTokens(`GET /o/${TOKEN}`)).toBe("GET /o/[token]");
    expect(redactTrackingTokens(`https://app.fluta.example/o/${TOKEN}/price-update?x=1`)).toBe(
      "https://app.fluta.example/o/[token]/price-update?x=1",
    );
  });

  it("leaves other text alone", () => {
    expect(redactTrackingTokens("/orders/abc and /store/freshfold")).toBe("/orders/abc and /store/freshfold");
  });
});

describe("logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never writes a tracking token, in the message, text, or an error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error(`failed at /o/${TOKEN}`, `/o/${TOKEN}`, new TypeError(`bad /o/${TOKEN}`), 42);
    const written = error.mock.calls[0];
    expect(JSON.stringify(written.map((part) => (part instanceof Error ? `${part.name} ${part.message} ${part.stack}` : part)))).not.toContain(
      TOKEN,
    );
    expect(written[2]).toMatchObject({ name: "TypeError", message: "bad /o/[token]" });
    expect(written[3]).toBe(42);
  });

  it("never writes a location field, at any depth", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("booking", {
      orderId: "o1",
      pickup: { latitude: 6.428123, longitude: 3.421988 },
      rows: [{ pickupLatitude: "6.428123", pickupLongitude: "3.421988" }],
    });
    const written = JSON.stringify(warn.mock.calls[0]);
    expect(written).not.toContain("6.428123");
    expect(written).not.toContain("3.421988");
    expect(warn.mock.calls[0][1]).toEqual({
      orderId: "o1",
      pickup: { latitude: "[redacted]", longitude: "[redacted]" },
      rows: [{ pickupLatitude: "[redacted]", pickupLongitude: "[redacted]" }],
    });
  });

  it("never writes the payer's email, card details, account numbers, or the secret key from a Paystack payload", () => {
    // A recorded charge.success event (test mode, values replaced).
    const event = {
      event: "charge.success",
      data: {
        id: 302961,
        domain: "test",
        status: "success",
        reference: "FLT-5b1e4c2a9d",
        amount: 620000,
        authorization: {
          authorization_code: "AUTH_8dfhjjdt",
          bin: "408408",
          last4: "4081",
          exp_month: "12",
          exp_year: "2030",
          card_type: "visa DEBIT",
          bank: "Test Bank",
          signature: "SIG_idyuhgd87dUYSHO92D",
          reusable: true,
        },
        customer: { id: 84312, email: "payer@example.com", customer_code: "CUS_hdhye17yj8qd2tx" },
        subaccount: { subaccount_code: "ACCT_test123", account_number: "0123456789", settlement_bank: "Test Bank" },
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("[paystack-webhook]", event, { secretKey: "sk_test_secret", accountNumber: "0123456789" });
    const written = JSON.stringify(warn.mock.calls[0]);
    for (const secret of ["payer@example.com", "AUTH_8dfhjjdt", "408408", "4081", "SIG_idyuhgd87dUYSHO92D", "0123456789", "sk_test_secret"]) {
      expect(written).not.toContain(secret);
    }
    expect(written).toContain("FLT-5b1e4c2a9d");
    expect(written).toContain("charge.success");
  });
});
