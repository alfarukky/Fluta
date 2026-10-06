import { describe, expect, it } from "vitest";

import { formatPhone, maskPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("reads a Nigerian number without a country code using the default country", () => {
    expect(normalizePhone("0803 123 4521", "NG")).toBe("+2348031234521");
    expect(normalizePhone("08031234521", "NG")).toBe("+2348031234521");
  });

  it("accepts Nigerian numbers written internationally", () => {
    expect(normalizePhone("+234 803 123 4521", "NG")).toBe("+2348031234521");
    expect(normalizePhone("+234 (0) 803-123-4521", "NG")).toBe("+2348031234521");
  });

  it("accepts valid foreign numbers whatever the default country", () => {
    expect(normalizePhone("+44 7911 123456", "NG")).toBe("+447911123456");
    expect(normalizePhone("+1 415 555 2671", "NG")).toBe("+14155552671");
  });

  it("reads a number without a country code by the default country passed in", () => {
    expect(normalizePhone("07911 123456", "GB")).toBe("+447911123456");
    expect(normalizePhone("07911 123456", "NG")).toBeNull();
  });

  it("rejects invalid numbers", () => {
    expect(normalizePhone("", "NG")).toBeNull();
    expect(normalizePhone("12345", "NG")).toBeNull();
    expect(normalizePhone("0803 123", "NG")).toBeNull();
    expect(normalizePhone("not a phone", "NG")).toBeNull();
    expect(normalizePhone("+234 803 123 4521 999", "NG")).toBeNull();
  });
});

describe("maskPhone", () => {
  it("masks a Nigerian number", () => {
    expect(maskPhone("+2348031234521")).toBe("+234 803 *** 4521");
  });

  it("masks foreign numbers by their own country code", () => {
    expect(maskPhone("+447911123456")).toBe("+44 791 *** 3456");
    expect(maskPhone("+14155552671")).toBe("+1 415 *** 2671");
  });

  it("never returns the full number for unexpected input", () => {
    expect(maskPhone("not a phone")).toBe("***");
    expect(maskPhone("+2341234")).not.toContain("1234");
  });
});

describe("formatPhone", () => {
  it("formats a stored number for display", () => {
    expect(formatPhone("+2348031234521")).toBe("+234 803 123 4521");
  });
});
