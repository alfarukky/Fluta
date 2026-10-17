import { describe, expect, it } from "vitest";

import { isCronAuthorized } from "./cron";

const SECRET = "a-cron-secret-that-is-at-least-32-characters";

describe("isCronAuthorized", () => {
  it("accepts the secret as a bearer token", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses a missing, wrong, or differently shaped credential", () => {
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    expect(isCronAuthorized("", SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it("refuses everything when no secret is set", () => {
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
  });
});
