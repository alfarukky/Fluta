import { describe, expect, it } from "vitest";

import { buildHeaders, PRIVATE_LINK_SOURCES } from "../../next.config";

describe("next.config headers", () => {
  it("sends noindex on every path on staging, booking pages included", () => {
    const [first] = buildHeaders(true);
    expect(first).toEqual({ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
  });

  it("keeps the private-link headers on staging", () => {
    expect(buildHeaders(true).map((rule) => rule.source).slice(1)).toEqual(PRIVATE_LINK_SOURCES);
  });

  it("adds no site-wide noindex outside staging", () => {
    expect(buildHeaders(false).map((rule) => rule.source)).toEqual(PRIVATE_LINK_SOURCES);
  });
});
