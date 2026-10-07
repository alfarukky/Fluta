import { describe, expect, it } from "vitest";

import { formatAreaCharge, formatNaira, formatNairaInput, formatServicePrice, parseNairaToKobo } from "./money";

describe("formatNaira", () => {
  it("formats whole naira with thousands separators", () => {
    expect(formatNaira(620_000)).toBe("₦6,200");
    expect(formatNaira(80_000)).toBe("₦800");
    expect(formatNaira(1_000_000_000)).toBe("₦10,000,000");
    expect(formatNaira(0)).toBe("₦0");
  });

  it("shows kobo only when non-zero", () => {
    expect(formatNaira(150_050)).toBe("₦1,500.50");
    expect(formatNaira(150_005)).toBe("₦1,500.05");
    expect(formatNaira(150_000)).toBe("₦1,500");
    expect(formatNaira(1)).toBe("₦0.01");
  });

  it("formats negative amounts with a leading minus sign", () => {
    expect(formatNaira(-50_000)).toBe("−₦500");
    expect(formatNaira(-150_050)).toBe("−₦1,500.50");
  });
});

describe("formatNairaInput", () => {
  it("formats the amount without the ₦ sign, so it parses back", () => {
    for (const kobo of [0, 80_000, 150_050, 1_000_000_000]) {
      expect(parseNairaToKobo(formatNairaInput(kobo))).toBe(kobo);
    }
    expect(formatNairaInput(150_050)).toBe("1,500.50");
  });
});

describe("parseNairaToKobo", () => {
  it.each([
    ["1500", 150_000],
    ["1,500", 150_000],
    ["1500.5", 150_050],
    ["1500.50", 150_050],
    ["1,500.50", 150_050],
    ["₦1,500", 150_000],
    ["₦ 1,500", 150_000],
    ["  1,500  ", 150_000],
    ["1,234,567.89", 123_456_789],
    ["0", 0],
    ["1500.10", 150_010],
  ])("accepts %j as %d kobo", (input, kobo) => {
    expect(parseNairaToKobo(input)).toBe(kobo);
  });

  it.each([
    "1.500,50", // European format
    "1,500,50", // commas not in groups of three
    "15,00",
    "1.234", // more than two decimal places
    "1.500",
    "-100",
    "abc",
    "",
    "   ",
    "₦",
    "1500.",
    ".50",
    "1 500",
    "12,3456",
    "1e3",
    "99999999999999999999",
  ])("rejects %j", (input) => {
    expect(parseNairaToKobo(input)).toBeNull();
  });
});

describe("formatServicePrice", () => {
  it("shows the price per unit for every pricing type", () => {
    expect(formatServicePrice({ price: 80_000, pricingType: "PER_ITEM", requiresQuote: false })).toBe("₦800 / item");
    expect(formatServicePrice({ price: 150_000, pricingType: "PER_KG", requiresQuote: false })).toBe("₦1,500 / kg");
    expect(formatServicePrice({ price: 250_000, pricingType: "PER_PACKAGE", requiresQuote: false })).toBe(
      "₦2,500 / package",
    );
  });

  it("shows a quote-required price as a starting price", () => {
    expect(formatServicePrice({ price: 500_000, pricingType: "PER_ITEM", requiresQuote: true })).toBe(
      "from ₦5,000 / item",
    );
    expect(formatServicePrice({ price: 150_000, pricingType: "PER_KG", requiresQuote: true })).toBe(
      "from ₦1,500 / kg",
    );
  });

  it("shows a quote-required ₦0 price as price on inspection", () => {
    for (const pricingType of ["PER_ITEM", "PER_KG", "PER_PACKAGE"] as const) {
      expect(formatServicePrice({ price: 0, pricingType, requiresQuote: true })).toBe("Price on inspection");
    }
  });
});

describe("formatAreaCharge", () => {
  it("shows a fixed charge in Naira, ₦0 as Free, and quote-required areas as such", () => {
    expect(formatAreaCharge({ chargeType: "FIXED", fixedCharge: 150_000 })).toBe("₦1,500");
    expect(formatAreaCharge({ chargeType: "FIXED", fixedCharge: 0 })).toBe("Free");
    expect(formatAreaCharge({ chargeType: "QUOTE_REQUIRED", fixedCharge: null })).toBe("Quote required");
  });
});
