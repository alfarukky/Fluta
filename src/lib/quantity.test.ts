import { describe, expect, it } from "vitest";

import { fromStoredQuantity, getQuantityMessage, getQuantityProblem, parseQuantity, toStoredQuantity } from "./quantity";

describe("parseQuantity", () => {
  it("reads whole numbers", () => {
    expect(parseQuantity("3")).toBe(3);
    expect(parseQuantity(" 12 ")).toBe(12);
    expect(parseQuantity("999")).toBe(999);
    expect(parseQuantity("0")).toBe(0);
  });

  it("rejects fractions and anything else", () => {
    for (const text of ["", "1.5", "2.0", "0.5", "-1", "1e2", "2,5", ".5", "2 pcs", "abc", "1234567"]) {
      expect(parseQuantity(text)).toBeNull();
    }
  });
});

describe("getQuantityProblem", () => {
  it("allows whole numbers from 1 to 999", () => {
    expect(getQuantityProblem(1)).toBeNull();
    expect(getQuantityProblem(999)).toBeNull();
  });

  it("refuses anything outside that range", () => {
    expect(getQuantityProblem(0)).toBe("TOO_SMALL");
    expect(getQuantityProblem(-3)).toBe("TOO_SMALL");
    expect(getQuantityProblem(1000)).toBe("TOO_LARGE");
    expect(getQuantityProblem(1.5)).toBe("INVALID");
    expect(getQuantityProblem(Number.NaN)).toBe("INVALID");
  });
});

describe("stored quantities", () => {
  it("writes whole numbers as text", () => {
    expect(toStoredQuantity(3)).toBe("3");
    expect(toStoredQuantity(999)).toBe("999");
  });

  it("never writes a fraction or an out-of-range quantity", () => {
    expect(() => toStoredQuantity(1.5)).toThrow(RangeError);
    expect(() => toStoredQuantity(0)).toThrow(RangeError);
    expect(() => toStoredQuantity(1000)).toThrow(RangeError);
  });

  it("reads stored Decimals and older snapshot text", () => {
    expect(fromStoredQuantity("3")).toBe(3);
    expect(fromStoredQuantity("3.000")).toBe(3);
    expect(fromStoredQuantity("12.00")).toBe(12);
  });

  it("refuses a stored fraction", () => {
    expect(() => fromStoredQuantity("2.5")).toThrow(RangeError);
  });
});

describe("getQuantityMessage", () => {
  it("explains a missing or unusable quantity", () => {
    expect(getQuantityMessage(null)).toBe("Enter how many");
    expect(getQuantityMessage(0)).toBe("Enter at least 1");
    expect(getQuantityMessage(1000)).toBe("Enter 999 or fewer");
    expect(getQuantityMessage(1.5)).toBe("Enter a whole number");
    expect(getQuantityMessage(3)).toBeNull();
  });
});
