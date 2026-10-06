import { z } from "zod";

import { normalizePhone } from "@/lib/phone";

import { brandColorSchema } from "./stores";

// Store phone numbers without a country code are Nigerian.
const STORE_PHONE_COUNTRY = "NG";

// Optional plain text: trimmed, blank saved as null.
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .transform((value) => value || null);
}

export const storeProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Store name must be at least 2 characters")
    .max(80, "Store name must be 80 characters or fewer"),
  description: optionalText(300, "Description"),
  address: optionalText(200, "Address"),
  // Stored in E.164.
  phone: z
    .string()
    .trim()
    .max(40, "Enter a valid phone number")
    .transform((value, ctx) => {
      if (!value) return null;
      const e164 = normalizePhone(value, STORE_PHONE_COUNTRY);
      if (!e164) {
        ctx.addIssue({ code: "custom", message: "Enter a valid phone number" });
        return z.NEVER;
      }
      return e164;
    }),
  email: z
    .string()
    .trim()
    .max(254, "Enter a valid email address")
    .transform((value) => value.toLowerCase() || null)
    .pipe(z.email("Enter a valid email address").nullable()),
});

export type StoreProfileInput = z.input<typeof storeProfileSchema>;
export type StoreProfile = z.output<typeof storeProfileSchema>;

// Blank clears a colour (the store then uses Fluta's own).
const optionalBrandColor = z
  .string()
  .trim()
  .transform((value) => value || null)
  .pipe(brandColorSchema.transform((value) => value.toUpperCase()).nullable());

export const storeBrandingSchema = z.object({
  primaryColor: optionalBrandColor,
  accentColor: optionalBrandColor,
});

export type StoreBranding = z.output<typeof storeBrandingSchema>;
