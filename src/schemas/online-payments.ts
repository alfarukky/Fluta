import { z } from "zod";

// A Paystack webhook event, after its signature has been checked. Only the
// fields Fluta reads are kept: anything else in the body (the payer's email,
// card details) is dropped here and never passed on.
export const paystackEventSchema = z.object({
  event: z.string().min(1).max(100),
  data: z
    .object({
      reference: z.string().min(1).max(100).optional(),
    })
    .loose()
    .transform(({ reference }) => ({ reference })),
});

export type PaystackEvent = z.infer<typeof paystackEventSchema>;
