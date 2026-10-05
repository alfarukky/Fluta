import { describe, expect, it } from "vitest";

import { getBookingUrl } from "./booking-link";

describe("getBookingUrl", () => {
  it("puts /store/{slug} on the app's base URL", () => {
    expect(getBookingUrl({ slug: "freshfold-laundry" }, "https://app.fluta.example")).toBe(
      "https://app.fluta.example/store/freshfold-laundry",
    );
  });

  it("ignores any path or trailing slash on the base URL", () => {
    expect(getBookingUrl({ slug: "cleanwave" }, "http://localhost:3000/")).toBe("http://localhost:3000/store/cleanwave");
    expect(getBookingUrl({ slug: "cleanwave" }, "http://localhost:3000/app")).toBe("http://localhost:3000/store/cleanwave");
  });
});
