import { describe, expect, it } from "vitest";

import { storeBrandingSchema, storeProfileSchema } from "./store-settings";
import { brandColorSchema } from "./stores";

const VALID_PROFILE = {
  name: "FreshFold Laundry",
  description: "",
  address: "",
  phone: "",
  email: "",
};

describe("storeProfileSchema", () => {
  it("trims values and saves blanks as null", () => {
    expect(storeProfileSchema.parse({ ...VALID_PROFILE, name: "  FreshFold Laundry " })).toEqual({
      name: "FreshFold Laundry",
      description: null,
      address: null,
      phone: null,
      email: null,
    });
  });

  it("stores the phone in E.164, reading local numbers as Nigerian", () => {
    expect(storeProfileSchema.parse({ ...VALID_PROFILE, phone: "0803 123 4521" }).phone).toBe("+2348031234521");
    expect(storeProfileSchema.parse({ ...VALID_PROFILE, phone: "+44 7911 123456" }).phone).toBe("+447911123456");
  });

  it("enforces the length limits", () => {
    const tooLong = (field: string, length: number) =>
      storeProfileSchema.safeParse({ ...VALID_PROFILE, [field]: "a".repeat(length) }).success;
    expect(tooLong("name", 1)).toBe(false);
    expect(tooLong("name", 2)).toBe(true);
    expect(tooLong("name", 80)).toBe(true);
    expect(tooLong("name", 81)).toBe(false);
    expect(tooLong("description", 300)).toBe(true);
    expect(tooLong("description", 301)).toBe(false);
    expect(tooLong("address", 200)).toBe(true);
    expect(tooLong("address", 201)).toBe(false);
  });

  it("rejects an invalid phone and email", () => {
    const result = storeProfileSchema.safeParse({ ...VALID_PROFILE, phone: "12345", email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual(["email", "phone"]);
  });

  it("lower-cases the email", () => {
    expect(storeProfileSchema.parse({ ...VALID_PROFILE, email: " Hello@FreshFold.example " }).email).toBe(
      "hello@freshfold.example",
    );
  });
});

describe("brand colours", () => {
  it("accepts only #RRGGBB", () => {
    for (const value of ["#173C32", "#ffeb3b", "#000000"]) expect(brandColorSchema.safeParse(value).success).toBe(true);
    for (const value of ["173C32", "#FFF", "#12345G", "red", "#1234567", "#123456 ", "#123456\n", "url(x)"]) {
      expect(brandColorSchema.safeParse(value).success).toBe(false);
    }
  });

  it("saves colours upper-case and blanks as null", () => {
    expect(storeBrandingSchema.parse({ primaryColor: "#173c32", accentColor: "" })).toEqual({
      primaryColor: "#173C32",
      accentColor: null,
    });
  });

  it("rejects anything that isn't #RRGGBB", () => {
    expect(storeBrandingSchema.safeParse({ primaryColor: "#173C32; color: red", accentColor: "" }).success).toBe(false);
  });
});
