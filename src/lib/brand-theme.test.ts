import { describe, expect, it } from "vitest";

import { AA_CONTRAST, contrastRatio, ensureContrast, getBrandTheme, readableTextOn } from "./brand-theme";

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
});

describe("readableTextOn", () => {
  it("puts white text on dark brand colours", () => {
    expect(readableTextOn("#173C32")).toBe("#FFFFFF");
    expect(readableTextOn("#1A56B0")).toBe("#FFFFFF");
    expect(readableTextOn("#000000")).toBe("#FFFFFF");
  });

  it("puts black text on light brand colours", () => {
    expect(readableTextOn("#FFEB3B")).toBe("#000000");
    expect(readableTextOn("#E4F1EA")).toBe("#000000");
    expect(readableTextOn("#FFFFFF")).toBe("#000000");
  });

  it("always reaches AA, including mid-tones", () => {
    for (const fill of ["#777777", "#FF5722", "#00A884", "#E91E63", "#808080", "#2196F3"] as const) {
      expect(contrastRatio(fill, readableTextOn(fill))).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });
});

describe("ensureContrast", () => {
  it("keeps a colour that is already readable", () => {
    expect(ensureContrast("#173C32", ["#FFFFFF"], "#000000")).toBe("#173C32");
  });

  it("moves a colour until it is readable on every surface", () => {
    const adjusted = ensureContrast("#FFEB3B", ["#F6F8F7", "#FFFFFF"], "#000000");
    expect(adjusted).not.toBe("#FFEB3B");
    expect(contrastRatio(adjusted, "#F6F8F7")).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
});

describe("getBrandTheme", () => {
  it("sets primary and accent variables for valid colours", () => {
    const theme = getBrandTheme({ primary: "#1a56b0", accent: "#ffeb3b" });
    expect(theme["data-brand-primary"]).toBe("");
    expect(theme["data-brand-accent"]).toBe("");
    expect(theme.style).toMatchObject({
      "--brand-primary": "#1A56B0",
      "--brand-primary-foreground": "#FFFFFF",
      "--brand-accent": "#FFEB3B",
      "--brand-accent-foreground": "#000000",
    });
  });

  it("keeps a dark brand colour readable on the dark theme", () => {
    const { style } = getBrandTheme({ primary: "#173C32", accent: null });
    expect(style["--brand-primary"]).toBe("#173C32");
    const dark = style["--brand-primary-dark"];
    for (const surface of ["#0D1412", "#141D1A", "#18221F"]) {
      expect(contrastRatio(dark, surface)).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
    expect(contrastRatio(dark, style["--brand-primary-dark-foreground"])).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("keeps a light brand colour readable on the light theme", () => {
    const { style } = getBrandTheme({ primary: "#FFEB3B", accent: null });
    const light = style["--brand-primary"];
    expect(contrastRatio(light, "#F6F8F7")).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(contrastRatio(light, style["--brand-primary-foreground"])).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(style["--brand-primary-dark"]).toBe("#FFEB3B");
  });

  it("ignores missing and invalid colours, so they never reach CSS", () => {
    for (const value of [null, undefined, "", "red", "#FFF", "#12345G", "#123456; background: url(x)", "#1234567"]) {
      const theme = getBrandTheme({ primary: value, accent: value });
      expect(theme).toEqual({ style: {} });
    }
  });
});
