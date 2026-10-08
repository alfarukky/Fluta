import { afterEach, describe, expect, it, vi } from "vitest";

import { rememberSignInEmail, takeSignInEmail } from "./sign-in-email";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("sign-in email hand-off", () => {
  it("is read once", () => {
    rememberSignInEmail("kemi@x.example");
    expect(takeSignInEmail()).toBe("kemi@x.example");
    expect(takeSignInEmail()).toBeNull();
  });

  it("does nothing when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => rememberSignInEmail("kemi@x.example")).not.toThrow();
    expect(takeSignInEmail()).toBeNull();
  });
});
