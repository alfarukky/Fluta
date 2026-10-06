import { describe, expect, it } from "vitest";

import { createLogoKey, getLogoUrl } from "./logo-url";

const PUBLIC_URL = "https://pub-example.r2.dev";

describe("createLogoKey", () => {
  it("generates a new key under the store's folder for every upload", () => {
    const first = createLogoKey("cmstore123", "png");
    expect(first).toMatch(/^stores\/cmstore123\/logo\/[0-9a-f-]{36}\.png$/);
    expect(createLogoKey("cmstore123", "png")).not.toBe(first);
  });
});

describe("getLogoUrl", () => {
  it("builds the public address from R2_PUBLIC_URL and the key", () => {
    const logoKey = createLogoKey("cmstore123", "webp");
    expect(getLogoUrl({ logoKey }, PUBLIC_URL)).toBe(`${PUBLIC_URL}/${logoKey}`);
    expect(getLogoUrl({ logoKey }, `${PUBLIC_URL}/`)).toBe(`${PUBLIC_URL}/${logoKey}`);
  });

  it("keeps a path on the public URL", () => {
    const logoKey = createLogoKey("cmstore123", "jpg");
    expect(getLogoUrl({ logoKey }, "https://cdn.example.com/fluta")).toBe(`https://cdn.example.com/fluta/${logoKey}`);
  });

  it("gives no address without a key or for a key Fluta didn't generate", () => {
    expect(getLogoUrl({ logoKey: null }, PUBLIC_URL)).toBeNull();
    for (const logoKey of ["https://evil.example/x.png", "//evil.example/x.png", "stores/a/logo/../../x.png", "logo.svg"]) {
      expect(getLogoUrl({ logoKey }, PUBLIC_URL)).toBeNull();
    }
  });
});
