import { z } from "zod";

import { PricingType } from "@/generated/prisma/enums";
import { formatNaira, parseNairaToKobo } from "@/lib/money";

export const MAX_SERVICE_PRICE = 1_000_000_000; // ₦10,000,000 in kobo
export const SERVICE_NAME_MAX = 80;
export const SERVICE_CATEGORY_MAX = 40;

export const PRICING_TYPE_LABELS: Record<PricingType, string> = {
  PER_ITEM: "Per item",
  PER_KG: "Per kg",
  PER_PACKAGE: "Per package",
};

// The add/edit form, as sent. Per-kg services always require a quote, whatever
// the form says; the price must be above ₦0 unless a quote is required (it is
// then the "from" price).
export const serviceFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Service name must be at least 2 characters")
      .max(SERVICE_NAME_MAX, `Service name must be ${SERVICE_NAME_MAX} characters or fewer`),
    // Blank (or only spaces) is saved as no category.
    category: z
      .string()
      .trim()
      .max(SERVICE_CATEGORY_MAX, `Category must be ${SERVICE_CATEGORY_MAX} characters or fewer`)
      .transform((value) => value || null),
    pricingType: z.enum(PricingType, "Choose how this service is priced"),
    price: z
      .string()
      .max(40, "Enter a price in Naira, like 1,500 or 1,500.50")
      .transform((value, ctx) => {
        const kobo = parseNairaToKobo(value);
        if (kobo === null) {
          ctx.addIssue({ code: "custom", message: "Enter a price in Naira, like 1,500 or 1,500.50" });
          return z.NEVER;
        }
        return kobo;
      })
      .refine((kobo) => kobo <= MAX_SERVICE_PRICE, `Price must be ${formatNaira(MAX_SERVICE_PRICE)} or less`),
    // A checkbox: "on" when ticked, missing (or "") when not.
    requiresQuote: z.string().transform((value) => value === "on" || value === "true"),
  })
  .transform((service) => ({
    ...service,
    requiresQuote: service.pricingType === PricingType.PER_KG || service.requiresQuote,
  }))
  .superRefine((service, ctx) => {
    if (service.price === 0 && !service.requiresQuote) {
      ctx.addIssue({
        code: "custom",
        path: ["price"],
        message: "Enter a price above ₦0, or turn on Quote required",
      });
    }
  });

export type ServiceFormInput = z.input<typeof serviceFormSchema>;
export type ServiceInput = z.output<typeof serviceFormSchema>;

// A service ID from the client. It is only ever looked up within the caller's
// own store.
export const serviceIdSchema = z.string().trim().min(1).max(64);
