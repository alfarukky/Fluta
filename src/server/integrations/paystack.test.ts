// @vitest-environment node
import { createHmac, timingSafeEqual } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// The real crypto, with timingSafeEqual watched.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import { createPaystackClient, isValidPaystackSignature, PaystackError } from "./paystack";

const SECRET = "sk_test_0123456789abcdef0123456789abcdef01234567";

// A recorded test-mode charge.success body, byte for byte as Paystack sends it
// (compact JSON, values replaced). The header is the HMAC of these bytes.
const RECORDED_BODY =
  '{"event":"charge.success","data":{"id":302961,"domain":"test","status":"success","reference":"FLT-5b1e4c2a9d",' +
  '"amount":620000,"currency":"NGN","paid_at":"2026-10-20T14:15:02.000Z","channel":"card",' +
  '"authorization":{"authorization_code":"AUTH_8dfhjjdt","bin":"408408","last4":"4081","signature":"SIG_x"},' +
  '"customer":{"id":84312,"email":"payer@example.com"},"metadata":{"order_id":"o1"}}}';

const encode = (text: string) => new TextEncoder().encode(text);
const sign = (bytes: Uint8Array, key = SECRET) => createHmac("sha512", key).update(bytes).digest("hex");

describe("isValidPaystackSignature", () => {
  const bytes = encode(RECORDED_BODY);
  const header = sign(bytes);

  it("accepts the recorded payload with its header, in either hex case", () => {
    expect(isValidPaystackSignature(bytes, header, SECRET)).toBe(true);
    expect(isValidPaystackSignature(bytes, header.toUpperCase(), SECRET)).toBe(true);
  });

  it("refuses the payload with one byte changed", () => {
    const tampered = bytes.slice();
    tampered[tampered.indexOf("6".charCodeAt(0))] = "7".charCodeAt(0); // 620000 → 720000
    expect(isValidPaystackSignature(tampered, header, SECRET)).toBe(false);
  });

  it("refuses the same JSON re-serialized: the raw bytes are what count", () => {
    const reserialized = encode(JSON.stringify(JSON.parse(RECORDED_BODY), null, 1));
    expect(isValidPaystackSignature(reserialized, header, SECRET)).toBe(false);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["short", header.slice(0, 64)],
    ["too long", `${header}00`],
    ["non-hex", `${header.slice(0, 126)}zz`],
    ["SHA-256 sized", "a".repeat(64)],
  ])("refuses a %s header", (_, value) => {
    expect(isValidPaystackSignature(bytes, value, SECRET)).toBe(false);
  });

  it("refuses a header made with another key", () => {
    expect(isValidPaystackSignature(bytes, sign(bytes, "sk_test_another"), SECRET)).toBe(false);
  });

  it("compares with timingSafeEqual", () => {
    vi.mocked(timingSafeEqual).mockClear();
    expect(isValidPaystackSignature(bytes, "0".repeat(128), SECRET)).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });
});

describe("createPaystackClient().listBanks", () => {
  const config = { secretKey: SECRET, mode: "test" as const };
  const bank = (id: number, name: string, code: string, extra: object = {}) => ({ id, name, code, active: true, is_deleted: false, type: "nuban", ...extra });
  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

  it("follows the cursor and keeps only active, undeleted NUBAN banks, with their ids", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({ status: true, data: [bank(1, "Access Bank", "044"), bank(2, "Old Bank", "999", { active: false })], meta: { next: "cursor2" } }),
      )
      .mockResolvedValueOnce(
        json({
          status: true,
          data: [bank(9, "Guaranty Trust Bank", "058"), bank(3, "Gone Bank", "998", { is_deleted: true }), bank(4, "Mobile Money", "MM", { type: "mobile_money" }), bank(635, "Goodnews Microfinance Bank", "50739"), bank(792, "Prospa Capital Microfinance Bank", "50739")],
          meta: { next: null },
        }),
      );

    await expect(createPaystackClient(config, fetchImpl).listBanks()).resolves.toEqual([
      { id: "1", name: "Access Bank", code: "044" },
      { id: "9", name: "Guaranty Trust Bank", code: "058" },
      // Two banks sharing a code are both kept: each is chosen by its id.
      { id: "635", name: "Goodnews Microfinance Bank", code: "50739" },
      { id: "792", name: "Prospa Capital Microfinance Bank", code: "50739" },
    ]);

    const [firstUrl, firstInit] = fetchImpl.mock.calls[0];
    const first = new URL(String(firstUrl));
    expect(first.origin + first.pathname).toBe("https://api.paystack.co/bank");
    expect(Object.fromEntries(first.searchParams)).toEqual({ country: "nigeria", currency: "NGN", perPage: "100", use_cursor: "true" });
    expect(firstInit?.headers).toMatchObject({ Authorization: `Bearer ${SECRET}` });
    expect(new URL(String(fetchImpl.mock.calls[1][0])).searchParams.get("next")).toBe("cursor2");
  });

  it("throws a short code with Paystack's error type, never its message", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ status: false, message: "Invalid key sk_test_leak", type: "validation_error", code: "invalid_key" }, { status: 401 }),
    );
    const error = await createPaystackClient(config, fetchImpl).listBanks().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaystackError);
    expect((error as PaystackError).message).toBe("HTTP 401 validation_error");
  });

  it("on 429 reports when to retry and calls Paystack only once", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ status: false }, { status: 429, headers: { "x-ratelimit-reset": "30" } }));
    const error = (await createPaystackClient(config, fetchImpl).listBanks().catch((caught: unknown) => caught)) as PaystackError;
    expect(error.message).toBe("HTTP 429");
    expect(error.retryAfterSeconds).toBe(30);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout, a network failure, and an unexpected body by code only", async () => {
    const timeout = Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    await expect(createPaystackClient(config, vi.fn<typeof fetch>().mockRejectedValue(timeout)).listBanks()).rejects.toThrow(/^timeout$/);
    await expect(createPaystackClient(config, vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"))).listBanks()).rejects.toThrow(
      /^network error$/,
    );
    await expect(createPaystackClient(config, vi.fn<typeof fetch>().mockResolvedValue(json({ status: true, data: "x" }))).listBanks()).rejects.toThrow(
      /^unexpected response$/,
    );
  });

  it("stops following a cursor that never ends", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => json({ status: true, data: [], meta: { next: "again" } }));
    await expect(createPaystackClient(config, fetchImpl).listBanks()).rejects.toThrow(/^too many pages$/);
    expect(fetchImpl).toHaveBeenCalledTimes(20);
  });
});

describe("createPaystackClient(): accounts and subaccounts", () => {
  const config = { secretKey: SECRET, mode: "test" as const };
  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });
  // A recorded test-mode subaccount, values replaced. Paystack returns the
  // full account number.
  const SUBACCOUNT = {
    integration: 100973,
    domain: "test",
    subaccount_code: "ACCT_4hl4xenwpjy5wb",
    business_name: "FreshFold Laundry",
    description: null,
    primary_contact_email: "ada@freshfold.example",
    settlement_bank: "Guaranty Trust Bank",
    account_number: "0123454521",
    account_name: "AMINA BELLO",
    percentage_charge: 0,
    is_verified: false,
    settlement_schedule: "AUTO",
    active: true,
    id: 55,
  };
  const subaccountFetch = () => vi.fn<typeof fetch>().mockImplementation(async () => json({ status: true, message: "ok", data: SUBACCOUNT }));
  const parsedSubaccount = {
    subaccountCode: "ACCT_4hl4xenwpjy5wb",
    businessName: "FreshFold Laundry",
    settlementBank: "Guaranty Trust Bank",
    accountName: "AMINA BELLO",
    accountNumberLast4: "4521",
    percentageCharge: 0,
    active: true,
    isVerified: false,
  };
  const ACCOUNT = { bankCode: "058", accountNumber: "0123454521" };

  it("resolves an account name with the number and bank code", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ status: true, data: { account_number: "0123454521", account_name: "AMINA BELLO", bank_id: 9 } }));
    await expect(createPaystackClient(config, fetchImpl).resolveAccount(ACCOUNT)).resolves.toEqual({ accountName: "AMINA BELLO" });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe("/bank/resolve");
    expect(Object.fromEntries(url.searchParams)).toEqual({ account_number: "0123454521", bank_code: "058" });
  });

  it("refuses a resolve response without a name", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ status: true, data: { account_name: " " } }));
    await expect(createPaystackClient(config, fetchImpl).resolveAccount(ACCOUNT)).rejects.toThrow(/^unexpected response$/);
  });

  it("creates a subaccount with bank_code and a 0% share for Fluta, keeping only the last 4 digits", async () => {
    const fetchImpl = subaccountFetch();
    const created = await createPaystackClient(config, fetchImpl).createSubaccount({
      ...ACCOUNT,
      businessName: "FreshFold Laundry",
      primaryContactEmail: "ada@freshfold.example",
    });
    expect(created).toEqual(parsedSubaccount);
    expect(JSON.stringify(created)).not.toContain("0123454521");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.paystack.co/subaccount");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      business_name: "FreshFold Laundry",
      bank_code: "058",
      account_number: "0123454521",
      percentage_charge: 0,
      primary_contact_email: "ada@freshfold.example",
    });
  });

  it("updates the bank account of the same subaccount, or switches it off", async () => {
    const fetchImpl = subaccountFetch();
    const client = createPaystackClient(config, fetchImpl);
    await client.updateSubaccount("ACCT_4hl4xenwpjy5wb", { bankCode: "044", accountNumber: "0987651234" });
    await client.updateSubaccount("ACCT_4hl4xenwpjy5wb", { active: false });

    const [[firstUrl, first], [, second]] = fetchImpl.mock.calls;
    expect(String(firstUrl)).toBe("https://api.paystack.co/subaccount/ACCT_4hl4xenwpjy5wb");
    expect(first?.method).toBe("PUT");
    expect(JSON.parse(String(first?.body))).toEqual({ bank_code: "044", account_number: "0987651234" });
    expect(JSON.parse(String(second?.body))).toEqual({ active: false });
  });

  it("fetches a subaccount", async () => {
    const fetchImpl = subaccountFetch();
    await expect(createPaystackClient(config, fetchImpl).fetchSubaccount("ACCT_4hl4xenwpjy5wb")).resolves.toEqual(parsedSubaccount);
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("GET");
  });

  it("refuses a subaccount code that isn't ACCT_ followed by letters and digits, without calling Paystack", async () => {
    const fetchImpl = subaccountFetch();
    const client = createPaystackClient(config, fetchImpl);
    await expect(client.fetchSubaccount("../bank")).rejects.toThrow(/^invalid subaccount code$/);
    await expect(client.updateSubaccount("ACCT_x/../y", { active: false })).rejects.toThrow(/^invalid subaccount code$/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a subaccount response it doesn't recognise", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ status: true, data: { ...SUBACCOUNT, subaccount_code: 12 } }));
    await expect(createPaystackClient(config, fetchImpl).fetchSubaccount("ACCT_4hl4xenwpjy5wb")).rejects.toThrow(/^unexpected response$/);
  });
});
