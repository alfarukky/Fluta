// Thrown for any failed Paystack call. Its message is a short code only
// ("HTTP 400 validation_error", "timeout", "unexpected response"), never
// Paystack's own message. On 429, retryAfterSeconds says when to try again;
// callers don't retry in a loop.
//
// In its own module so the fake Paystack client (src/test/fake-paystack.ts)
// can throw it without importing paystack.ts, which the integration setup
// replaces with that fake: importing it there would wait on itself forever.
export class PaystackError extends Error {
  override name = "PaystackError";

  constructor(
    code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}
