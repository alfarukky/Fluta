// @vitest-environment node
import { describe, expect, it } from "vitest";

import { generateToken } from "./tokens";
import { getTrackingUrl } from "./tracking-link";

describe("getTrackingUrl", () => {
  it("puts /o/{token} on the app's base URL", () => {
    const token = generateToken();
    expect(getTrackingUrl(token, "https://app.fluta.example")).toBe(`https://app.fluta.example/o/${token}`);
  });

  it("ignores any path or trailing slash on the base URL", () => {
    expect(getTrackingUrl("abc", "http://localhost:3000/")).toBe("http://localhost:3000/o/abc");
    expect(getTrackingUrl("abc", "http://localhost:3000/app")).toBe("http://localhost:3000/o/abc");
  });

  it("keeps the token exactly as issued (base64url needs no escaping)", () => {
    const token = "Ab-_0123456789abcdefghijklmnopqrstuvwxyzABCD".slice(0, 43);
    expect(new URL(getTrackingUrl(token, "https://app.fluta.example")).pathname).toBe(`/o/${token}`);
  });
});
