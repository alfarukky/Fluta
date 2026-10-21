import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { getPaystackConfig, type PaystackConfig } from "@/lib/env";

// Paystack's API: the only module that calls api.paystack.co. Every response
// is checked with Zod, and every failure is a PaystackError with a short code
// only. Never log the secret key, the Authorization header, or a response
// body (they can carry emails, account numbers, and card details). Tests
// replace the client with the fake in src/test/fake-paystack.ts.

const API_BASE = "https://api.paystack.co";
const REQUEST_TIMEOUT_MS = 15_000;
// The bank list is a few hundred banks at 100 a page; this only stops a
// broken cursor from looping forever.
const MAX_BANK_PAGES = 20;

export interface PaystackBank {
  name: string;
  code: string;
}

export interface PaystackClient {
  // Nigerian banks that can receive settlements (active NUBAN banks).
  listBanks(): Promise<PaystackBank[]>;
}

// Thrown for any failed call. Its message is a short code only
// ("HTTP 400 validation_error", "timeout", "unexpected response"), never
// Paystack's own message. On 429, retryAfterSeconds says when to try again;
// callers don't retry in a loop.
export class PaystackError extends Error {
  override name = "PaystackError";

  constructor(
    code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

// Paystack's error bodies carry status, message, type, and code. Only `type`
// (or `code`) is kept, and only when it looks like an identifier.
const errorBodySchema = z.object({ type: z.string().optional(), code: z.string().optional() });

const bankListSchema = z.object({
  status: z.literal(true),
  data: z.array(
    z.object({
      name: z.string(),
      code: z.string(),
      active: z.boolean(),
      is_deleted: z.boolean().nullable().optional(),
      type: z.string().nullable().optional(),
    }),
  ),
  meta: z.object({ next: z.string().nullable().optional() }).optional(),
});

type FetchLike = typeof fetch;

let client: PaystackClient | null | undefined;

// Null when Paystack isn't configured: online payments are unavailable.
export function getPaystackClient(): PaystackClient | null {
  if (client === undefined) {
    const config = getPaystackConfig();
    client = config ? createPaystackClient(config) : null;
  }
  return client;
}

export function createPaystackClient(config: PaystackConfig, fetchImpl: FetchLike = fetch): PaystackClient {
  async function get(path: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(path, API_BASE);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${config.secretKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PaystackError(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error");
    }
    if (!response.ok) throw await toPaystackError(response);
    return response.json().catch(() => null);
  }

  return {
    async listBanks() {
      const banks: PaystackBank[] = [];
      let next: string | undefined;
      for (let page = 0; page < MAX_BANK_PAGES; page++) {
        const parsed = bankListSchema.safeParse(
          await get("/bank", {
            country: "nigeria",
            currency: "NGN",
            perPage: "100",
            use_cursor: "true",
            ...(next ? { next } : {}),
          }),
        );
        if (!parsed.success) throw new PaystackError("unexpected response");
        for (const bank of parsed.data.data) {
          if (bank.active && !bank.is_deleted && bank.type === "nuban") banks.push({ name: bank.name, code: bank.code });
        }
        next = parsed.data.meta?.next ?? undefined;
        if (!next) return banks;
      }
      throw new PaystackError("too many pages");
    },
  };
}

async function toPaystackError(response: Response): Promise<PaystackError> {
  const body = errorBodySchema.safeParse(await response.json().catch(() => null));
  const kind = body.success ? (body.data.type ?? body.data.code) : undefined;
  const code = `HTTP ${response.status}${kind && /^[a-z_]{1,40}$/.test(kind) ? ` ${kind}` : ""}`;
  if (response.status !== 429) return new PaystackError(code);
  // x-ratelimit-reset: seconds until the limit resets.
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  return new PaystackError(code, Number.isFinite(reset) && reset >= 0 ? reset : undefined);
}

// Paystack signs each webhook with HMAC SHA512 of the exact raw body, keyed
// with the secret key, sent as hex in x-paystack-signature. Check it on the
// bytes as received, before parsing anything.
export function isValidPaystackSignature(raw: Uint8Array, header: string | null, secretKey: string): boolean {
  if (!header || !/^[0-9a-f]{128}$/i.test(header)) return false;
  const expected = createHmac("sha512", secretKey).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(header, "hex"));
}
