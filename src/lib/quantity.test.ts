import { describe, expect, it } from "vitest";

import { formatQuantity, fromDecimalString, getQuantityProblem, parseHundredths, toDecimalString } from "./quantity";

describe("parseHundredths", () => {
  it("reads whole numbers and up to two decimal places", () => {
    expect(parseHundredths("3")).toBe(300);
    expect(parseHundredths(" 2.5 ")).toBe(250);
    expect(parseHundredths("0.15")).toBe(15);
    expect(parseHundredths("999.99")).toBe(99_999);
  });

  it("rejects anything else", () => {
    for (const text of ["", "2.555", "-1", "1e2", "2,5", ".5", "abc", "1234567"]) {
      expect(parseHundredths(text)).toBeNull();
    }
  });
});

describe("getQuantityProblem", () => {
  it("allows 1–999 whole items or packages", () => {
    expect(getQuantityProblem(100, "PER_ITEM")).toBeNull();
    expect(getQuantityProblem(99_900, "PER_PACKAGE")).toBeNull();
    expect(getQuantityProblem(0, "PER_ITEM")).toBe("TOO_SMALL");
    expect(getQuantityProblem(100_000, "PER_ITEM")).toBe("TOO_LARGE");
    expect(getQuantityProblem(250, "PER_ITEM")).toBe("INVALID");
  });

  it("allows 0.1–999.99 kg", () => {
    expect(getQuantityProblem(10, "PER_KG")).toBeNull();
    expect(getQuantityProblem(99_999, "PER_KG")).toBeNull();
    expect(getQuantityProblem(9, "PER_KG")).toBe("TOO_SMALL");
    expect(getQuantityProblem(100_000, "PER_KG")).toBe("TOO_LARGE");
  });
});

describe("decimal strings", () => {
  it("writes and reads the Decimal column form", () => {
    expect(toDecimalString(250)).toBe("2.50");
    expect(toDecimalString(5)).toBe("0.05");
    expect(toDecimalString(300)).toBe("3.00");
    expect(fromDecimalString("2.500")).toBe(250);
    expect(fromDecimalString("3")).toBe(300);
    expect(fromDecimalString("0.050")).toBe(5);
  });
});

describe("formatQuantity", () => {
  it("drops trailing zeros and labels weights", () => {
    expect(formatQuantity(500, "PER_ITEM")).toBe("5");
    expect(formatQuantity(250, "PER_KG")).toBe("2.5 kg");
    expect(formatQuantity(205, "PER_KG")).toBe("2.05 kg");
    expect(formatQuantity(300, "PER_KG")).toBe("3 kg");
  });
});
