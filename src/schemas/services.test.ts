import { describe, expect, it } from "vitest";

import { serviceFormSchema, type ServiceFormInput } from "./services";

// Any strings, as a form can send them.
type FormValues = Record<keyof ServiceFormInput, string>;

const VALID: FormValues = {
  name: "  Shirt ",
  category: " Wash & iron ",
  pricingType: "PER_ITEM",
  price: "₦800",
  requiresQuote: "",
};

function parse(change: Partial<FormValues>) {
  return serviceFormSchema.safeParse({ ...VALID, ...change });
}

function errorField(change: Partial<FormValues>) {
  const result = parse(change);
  return result.success ? null : result.error.issues[0].path[0];
}

describe("serviceFormSchema", () => {
  it("trims text and stores the price in kobo", () => {
    expect(parse({}).data).toEqual({
      name: "Shirt",
      category: "Wash & iron",
      pricingType: "PER_ITEM",
      price: 80_000,
      requiresQuote: false,
    });
  });

  it("saves a blank or whitespace-only category as null", () => {
    expect(parse({ category: "" }).data?.category).toBeNull();
    expect(parse({ category: "    " }).data?.category).toBeNull();
  });

  it("always requires a quote for per-kg services", () => {
    expect(parse({ pricingType: "PER_KG", requiresQuote: "" }).data?.requiresQuote).toBe(true);
    expect(parse({ pricingType: "PER_KG", requiresQuote: "false" }).data?.requiresQuote).toBe(true);
  });

  it("lets per-item and per-package services set the quote flag", () => {
    expect(parse({ requiresQuote: "on" }).data?.requiresQuote).toBe(true);
    expect(parse({ pricingType: "PER_PACKAGE", requiresQuote: "" }).data?.requiresQuote).toBe(false);
  });

  it("allows a ₦0 price only when a quote is required", () => {
    expect(errorField({ price: "0" })).toBe("price");
    expect(parse({ price: "0", requiresQuote: "on" }).data?.price).toBe(0);
    expect(parse({ price: "0", pricingType: "PER_KG" }).data?.price).toBe(0);
  });

  it("caps the price at ₦10,000,000", () => {
    expect(parse({ price: "10,000,000" }).data?.price).toBe(1_000_000_000);
    expect(errorField({ price: "10,000,000.01" })).toBe("price");
  });

  it("rejects invalid values", () => {
    expect(errorField({ name: " S " })).toBe("name");
    expect(errorField({ name: "x".repeat(81) })).toBe("name");
    expect(errorField({ category: "x".repeat(41) })).toBe("category");
    expect(errorField({ pricingType: "PER_HOUR" })).toBe("pricingType");
    expect(errorField({ price: "1.500,50" })).toBe("price");
    expect(errorField({ price: "-100" })).toBe("price");
    expect(errorField({ price: "" })).toBe("price");
  });
});
