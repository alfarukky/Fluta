// @vitest-environment node
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "sk_test_0123456789abcdef0123456789abcdef01234567";
const config = vi.hoisted(() => ({ current: null as { secretKey: string; mode: "test" | "live" } | null }));
vi.mock("@/lib/env", () => ({ getPaystackConfig: () => config.current }));
// No database here: every reference is unknown (not Fluta's), so nothing is written.
vi.mock("@/server/data/online-payments", () => ({ findOnlinePaymentByReference: async () => null }));

const { POST } = await import("./route");

const URL_ = "http://localhost:3000/api/webhooks/paystack";
const BODY = JSON.stringify({
  event: "charge.success",
  data: {
    status: "success",
    reference: "FLT-5b1e4c2a9d",
    amount: 620000,
    currency: "NGN",
    domain: "test",
    customer: { email: "payer@example.com" },
  },
});
const sign = (body: string | Uint8Array, key = SECRET) => createHmac("sha512", key).update(body).digest("hex");

function webhook(body: string, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-paystack-signature": sign(body), ...headers },
  });
}

describe("POST /api/webhooks/paystack", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    config.current = { secretKey: SECRET, mode: "test" };
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("acknowledges a signed event and logs only its name and reference", async () => {
    const response = await POST(webhook(BODY, { "x-real-ip": "52.31.139.75" }));
    expect(response.status).toBe(200);
    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(logged).toContain("charge.success");
    expect(logged).toContain("FLT-5b1e4c2a9d");
    expect(logged).not.toContain("payer@example.com");
    expect(logged).not.toContain("620000");
    expect(warn).not.toHaveBeenCalled();
  });

  it("acknowledges a charge.success without the expected fields, and ignores it", async () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "x", customer: { email: "payer@example.com" } } });
    const response = await POST(webhook(body, { "x-real-ip": "52.31.139.75" }));
    expect(response.status).toBe(200);
    expect(JSON.stringify(warn.mock.calls)).toContain("without the expected fields");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("payer@example.com");
  });

  it("acknowledges other signed events and ignores them", async () => {
    const body = JSON.stringify({ event: "refund.processed", data: { reference: "x" } });
    const response = await POST(webhook(body, { "x-real-ip": "52.49.173.169" }));
    expect(response.status).toBe(200);
    expect(JSON.stringify(info.mock.calls)).toContain("refund.processed ignored");
  });

  it("refuses a tampered body", async () => {
    const tampered = BODY.replace("620000", "720000");
    const response = await POST(new Request(URL_, { method: "POST", body: tampered, headers: { "x-paystack-signature": sign(BODY) } }));
    expect(response.status).toBe(401);
    expect(info).not.toHaveBeenCalled();
  });

  it("refuses a missing signature or one made with another key", async () => {
    expect((await POST(new Request(URL_, { method: "POST", body: BODY }))).status).toBe(401);
    expect((await POST(webhook(BODY, { "x-paystack-signature": sign(BODY, "sk_test_other") }))).status).toBe(401);
  });

  it("refuses an empty or oversized body before checking anything", async () => {
    expect((await POST(new Request(URL_, { method: "POST", body: "" }))).status).toBe(400);
    const big = JSON.stringify({ event: "charge.success", data: { padding: "x".repeat(70 * 1024) } });
    expect((await POST(webhook(big))).status).toBe(400);
  });

  it("is a 404 when Paystack isn't configured", async () => {
    config.current = null;
    expect((await POST(webhook(BODY))).status).toBe(404);
  });

  it("acknowledges a signed body that isn't an event", async () => {
    expect((await POST(webhook("not json", { "x-real-ip": "52.214.14.220" }))).status).toBe(200);
    expect((await POST(webhook(JSON.stringify({ hello: "world" }), { "x-real-ip": "52.214.14.220" }))).status).toBe(200);
  });

  it("warns, but still accepts, a signed event from outside Paystack's addresses", async () => {
    const response = await POST(webhook(BODY, { "x-real-ip": "203.0.113.9" }));
    expect(response.status).toBe(200);
    expect(JSON.stringify(warn.mock.calls)).toContain("outside Paystack's addresses (203.0.113.9)");
  });
});
