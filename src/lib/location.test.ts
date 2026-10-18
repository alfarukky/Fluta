import { describe, expect, it } from "vitest";

import { getGoogleMapsUrl, parseCoordinates } from "./location";

describe("parseCoordinates", () => {
  it("accepts finite numbers in range, rounded to 6 decimal places", () => {
    expect(parseCoordinates(6.4281234567, 3.4219876543)).toEqual({ latitude: 6.428123, longitude: 3.421988 });
    expect(parseCoordinates(9.0765, 7.3986)).toEqual({ latitude: 9.0765, longitude: 7.3986 });
  });

  it("accepts the edges of each range", () => {
    expect(parseCoordinates(-90, -180)).toEqual({ latitude: -90, longitude: -180 });
    expect(parseCoordinates(90, 180)).toEqual({ latitude: 90, longitude: 180 });
    expect(parseCoordinates(0, 0)).toEqual({ latitude: 0, longitude: 0 });
  });

  it("never gives -0 for a tiny negative", () => {
    const coordinates = parseCoordinates(-0.0000001, -0.0000004);
    expect(Object.is(coordinates?.latitude, 0)).toBe(true);
    expect(Object.is(coordinates?.longitude, 0)).toBe(true);
  });

  it("ignores values out of range", () => {
    expect(parseCoordinates(90.000001, 3)).toBeNull();
    expect(parseCoordinates(-91, 3)).toBeNull();
    expect(parseCoordinates(6, 180.5)).toBeNull();
    expect(parseCoordinates(6, -181)).toBeNull();
  });

  it("ignores not-a-number and infinity", () => {
    expect(parseCoordinates(Number.NaN, 3)).toBeNull();
    expect(parseCoordinates(6, Number.NaN)).toBeNull();
    expect(parseCoordinates(Number.POSITIVE_INFINITY, 3)).toBeNull();
    expect(parseCoordinates(6, Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("ignores anything that isn't a pair of numbers", () => {
    expect(parseCoordinates("6.4", "3.4")).toBeNull();
    expect(parseCoordinates(6.4, undefined)).toBeNull();
    expect(parseCoordinates(null, null)).toBeNull();
    expect(parseCoordinates({}, [])).toBeNull();
  });
});

describe("getGoogleMapsUrl", () => {
  it("links to Google Maps at that spot", () => {
    expect(getGoogleMapsUrl(6.428123, 3.421988)).toBe("https://www.google.com/maps/search/?api=1&query=6.428123,3.421988");
    expect(getGoogleMapsUrl(-1.5, -0.25)).toBe("https://www.google.com/maps/search/?api=1&query=-1.5,-0.25");
  });
});
