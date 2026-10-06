// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decodePng, expectedModules, readModules } from "@/test/qr";

import { getBookingShare, getBookingUrl } from "./booking-link";

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

describe("getBookingShare", () => {
  it("returns the booking link and a QR code that encodes exactly that link", async () => {
    const { bookingUrl, qrCodePng } = await getBookingShare({ slug: "freshfold-laundry" }, "https://app.fluta.example");
    expect(bookingUrl).toBe("https://app.fluta.example/store/freshfold-laundry");
    expect(readModules(decodePng(qrCodePng))).toEqual(expectedModules(bookingUrl));
  });
});
