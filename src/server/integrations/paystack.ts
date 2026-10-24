import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { getPaystackConfig, type PaystackConfig } from "@/lib/env";

import { PaystackError } from "./paystack-error";

export { PaystackError };

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

// Paystack's id is unique; the code is what payouts and account lookups use,
// and a few banks share one (two names for the same bank, or two
// microfinance banks), so a bank is chosen by id.
export interface PaystackBank {
  id: string;
  name: string;
  code: string;
}

// A store's settlement account as Paystack holds it. Only the last 4 digits
// of the account number are kept: the full number never leaves this module.
export interface PaystackSubaccount {
  subaccountCode: string;
  businessName: string;
  // The bank's name, as Paystack returns it.
  settlementBank: string;
  accountName: string | null;
  accountNumberLast4: string | null;
  // What Fluta (the main account) receives from each payment, in percent.
  percentageCharge: number;
  active: boolean;
  isVerified: boolean | null;
}

export interface SettlementAccountDetails {
  bankCode: string;
  // Ten digits (NUBAN). Sent to Paystack, never stored or logged.
  accountNumber: string;
}

// Starting one payment on Paystack's checkout (plan 6.3). Amounts in kobo.
export interface InitializeTransactionInput {
  amountKobo: number;
  // Required by Paystack: the payer's receipt goes here.
  email: string;
  currency: string;
  // Fluta's own reference, saved on the PENDING Payment first (plan 6.4).
  reference: string;
  // Where Paystack sends the customer afterwards. Holds the raw tracking
  // token: never log it.
  callbackUrl: string;
  // The store's subaccount. Paystack's fees come from its share.
  subaccountCode: string;
  // Fluta's fee for this payment, sent even at 0 (plan 6.3).
  transactionChargeKobo: number;
  // Sent to Paystack as a JSON string.
  metadata: Record<string, unknown>;
}

export interface InitializedTransaction {
  // Paystack's checkout page, always on checkout.paystack.com.
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

// What Paystack says about one transaction (plan 6.6). `status` is the
// payment's status, not the API call's. Nothing about the card or payer.
export interface VerifiedTransaction {
  status: "abandoned" | "failed" | "ongoing" | "pending" | "processing" | "queued" | "reversed" | "success";
  reference: string;
  amountKobo: number;
  currency: string;
  domain: "test" | "live";
  paidAt: Date | null;
  // Paystack's own fee, in kobo.
  feesKobo: number | null;
  // Null when Paystack sends no split details.
  subaccountCode: string | null;
}

export interface PaystackClient {
  // Nigerian banks that can receive settlements (active NUBAN banks).
  listBanks(): Promise<PaystackBank[]>;
  // The account holder's name for a bank account.
  resolveAccount(account: SettlementAccountDetails): Promise<{ accountName: string }>;
  // A subaccount that settles to the store's bank. Fluta's share is always
  // 0%: a fee, when there is one, is set on each transaction (plan 6.3).
  createSubaccount(input: SettlementAccountDetails & { businessName: string; primaryContactEmail: string }): Promise<PaystackSubaccount>;
  // A new bank account for an existing subaccount (its code stays the same),
  // or { active: false } to switch off a duplicate.
  updateSubaccount(subaccountCode: string, update: SettlementAccountDetails | { active: false }): Promise<PaystackSubaccount>;
  fetchSubaccount(subaccountCode: string): Promise<PaystackSubaccount>;
  initializeTransaction(input: InitializeTransactionInput): Promise<InitializedTransaction>;
  verifyTransaction(reference: string): Promise<VerifiedTransaction>;
}

// Paystack's error bodies carry status, message, type, and code. Only `type`
// (or `code`) is kept, and only when it looks like an identifier.
const errorBodySchema = z.object({ type: z.string().optional(), code: z.string().optional() });

const bankListSchema = z.object({
  status: z.literal(true),
  data: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      code: z.string(),
      active: z.boolean(),
      is_deleted: z.boolean().nullable().optional(),
      type: z.string().nullable().optional(),
    }),
  ),
  meta: z.object({ next: z.string().nullable().optional() }).optional(),
});

// Paystack returns the full account number; only its last 4 digits are kept.
const subaccountResponseSchema = z.object({
  status: z.literal(true),
  data: z
    .object({
      subaccount_code: z.string().regex(/^ACCT_[A-Za-z0-9]+$/),
      business_name: z.string(),
      settlement_bank: z.string(),
      account_name: z.string().nullable().optional(),
      account_number: z.string().nullable().optional(),
      percentage_charge: z.coerce.number(),
      active: z.boolean().optional(),
      is_verified: z.boolean().nullable().optional(),
    })
    .transform(
      (data): PaystackSubaccount => ({
        subaccountCode: data.subaccount_code,
        businessName: data.business_name,
        settlementBank: data.settlement_bank,
        accountName: data.account_name ?? null,
        accountNumberLast4: data.account_number ? data.account_number.slice(-4) : null,
        percentageCharge: data.percentage_charge,
        active: data.active ?? true,
        isVerified: data.is_verified ?? null,
      }),
    ),
});

const resolveResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({ account_name: z.string().trim().min(1) }),
});

const SUBACCOUNT_CODE = /^ACCT_[A-Za-z0-9]+$/;
// Paystack allows only alphanumerics, "-", ".", and "=" in a reference.
const REFERENCE = /^[A-Za-z0-9.=-]{1,100}$/;
export const PAYSTACK_CHECKOUT_ORIGIN = "https://checkout.paystack.com/";

const initializeResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({
    authorization_url: z.string().refine((url) => url.startsWith(PAYSTACK_CHECKOUT_ORIGIN)),
    access_code: z.string().min(1),
    reference: z.string().min(1),
  }),
});

// Only the fields Fluta checks. The card ("authorization"), the customer,
// and the full log are dropped here. The split's shape is unconfirmed
// (plan 6.6), so a subaccount code is read only when present.
const verifyResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({
    status: z.enum(["abandoned", "failed", "ongoing", "pending", "processing", "queued", "reversed", "success"]),
    reference: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    domain: z.enum(["test", "live"]),
    paid_at: z.string().nullable().optional(),
    fees: z.number().int().nullable().optional(),
    subaccount: z.object({ subaccount_code: z.string().optional() }).loose().nullable().optional(),
  }),
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
  async function call(
    method: "GET" | "POST" | "PUT",
    path: string,
    { query = {}, body }: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<unknown> {
    const url = new URL(path, API_BASE);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PaystackError(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error");
    }
    if (!response.ok) throw await toPaystackError(response);
    return response.json().catch(() => null);
  }

  const get = (path: string, query: Record<string, string>) => call("GET", path, { query });

  function subaccountPath(code: string): string {
    if (!SUBACCOUNT_CODE.test(code)) throw new PaystackError("invalid subaccount code");
    return `/subaccount/${code}`;
  }

  function parseSubaccount(body: unknown): PaystackSubaccount {
    const parsed = subaccountResponseSchema.safeParse(body);
    if (!parsed.success) throw new PaystackError("unexpected response");
    return parsed.data.data;
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
          if (bank.active && !bank.is_deleted && bank.type === "nuban") banks.push({ id: String(bank.id), name: bank.name, code: bank.code });
        }
        next = parsed.data.meta?.next ?? undefined;
        if (!next) return banks;
      }
      throw new PaystackError("too many pages");
    },

    async resolveAccount({ bankCode, accountNumber }) {
      const parsed = resolveResponseSchema.safeParse(
        await get("/bank/resolve", { account_number: accountNumber, bank_code: bankCode }),
      );
      if (!parsed.success) throw new PaystackError("unexpected response");
      return { accountName: parsed.data.data.account_name };
    },

    async createSubaccount({ businessName, bankCode, accountNumber, primaryContactEmail }) {
      return parseSubaccount(
        await call("POST", "/subaccount", {
          body: {
            business_name: businessName,
            bank_code: bankCode,
            account_number: accountNumber,
            percentage_charge: 0,
            primary_contact_email: primaryContactEmail,
          },
        }),
      );
    },

    async updateSubaccount(subaccountCode, update) {
      const body = "active" in update ? { active: false } : { bank_code: update.bankCode, account_number: update.accountNumber };
      return parseSubaccount(await call("PUT", subaccountPath(subaccountCode), { body }));
    },

    async fetchSubaccount(subaccountCode) {
      return parseSubaccount(await call("GET", subaccountPath(subaccountCode)));
    },

    async initializeTransaction(input) {
      if (!SUBACCOUNT_CODE.test(input.subaccountCode)) throw new PaystackError("invalid subaccount code");
      if (!REFERENCE.test(input.reference)) throw new PaystackError("invalid reference");
      // No `channels`: Paystack's defaults apply (plan decision 6).
      const parsed = initializeResponseSchema.safeParse(
        await call("POST", "/transaction/initialize", {
          body: {
            amount: String(input.amountKobo),
            email: input.email,
            currency: input.currency,
            reference: input.reference,
            callback_url: input.callbackUrl,
            subaccount: input.subaccountCode,
            bearer: "subaccount",
            transaction_charge: input.transactionChargeKobo,
            metadata: JSON.stringify(input.metadata),
          },
        }),
      );
      if (!parsed.success) throw new PaystackError("unexpected response");
      const { data } = parsed.data;
      return { authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
    },

    async verifyTransaction(reference) {
      if (!REFERENCE.test(reference)) throw new PaystackError("invalid reference");
      const parsed = verifyResponseSchema.safeParse(await call("GET", `/transaction/verify/${reference}`));
      if (!parsed.success) throw new PaystackError("unexpected response");
      const { data } = parsed.data;
      const paidAt = data.paid_at ? new Date(data.paid_at) : null;
      return {
        status: data.status,
        reference: data.reference,
        amountKobo: data.amount,
        currency: data.currency,
        domain: data.domain,
        paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
        feesKobo: data.fees ?? null,
        subaccountCode: data.subaccount?.subaccount_code ?? null,
      };
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
