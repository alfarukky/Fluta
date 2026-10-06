import { describe, expect, it } from "vitest";

import { jpegBytes, pngBytes, svgBytes, webpBytes } from "@/test/images";

import { checkLogoFile, detectLogoType, LOGO_MAX_BYTES } from "./logo-file";

describe("detectLogoType", () => {
  it("recognises PNG, JPEG and WebP from their first bytes", () => {
    expect(detectLogoType(pngBytes(10, 10))?.contentType).toBe("image/png");
    expect(detectLogoType(jpegBytes(10, 10))?.contentType).toBe("image/jpeg");
    expect(detectLogoType(webpBytes(10, 10))?.contentType).toBe("image/webp");
  });

  it("refuses SVG, GIF, text, and truncated headers", () => {
    expect(detectLogoType(svgBytes())).toBeNull();
    expect(detectLogoType(new TextEncoder().encode("GIF89a\x01\x00\x01\x00"))).toBeNull();
    expect(detectLogoType(new TextEncoder().encode("hello.png"))).toBeNull();
    expect(detectLogoType(pngBytes(10, 10).subarray(0, 4))).toBeNull();
    // RIFF but not WebP (e.g. a WAV file)
    expect(detectLogoType(new TextEncoder().encode("RIFF\x00\x00\x00\x00WAVEfmt "))).toBeNull();
  });
});

describe("checkLogoFile", () => {
  it("accepts each allowed type within the limits and reads its dimensions", () => {
    expect(checkLogoFile(pngBytes(512, 256))).toMatchObject({ ok: true, width: 512, height: 256 });
    expect(checkLogoFile(jpegBytes(2000, 2000))).toMatchObject({ ok: true, width: 2000, height: 2000 });
    expect(checkLogoFile(webpBytes(800, 600))).toMatchObject({ ok: true, width: 800, height: 600 });
  });

  it("accepts exactly 1 MB and rejects anything larger", () => {
    expect(checkLogoFile(pngBytes(100, 100, LOGO_MAX_BYTES))).toMatchObject({ ok: true });
    expect(checkLogoFile(pngBytes(100, 100, LOGO_MAX_BYTES + 1))).toEqual({ ok: false, error: "TOO_LARGE" });
  });

  it("rejects images over 2000 pixels in either direction", () => {
    expect(checkLogoFile(pngBytes(2001, 100))).toEqual({ ok: false, error: "TOO_MANY_PIXELS" });
    expect(checkLogoFile(jpegBytes(100, 2001))).toEqual({ ok: false, error: "TOO_MANY_PIXELS" });
    expect(checkLogoFile(webpBytes(4000, 4000))).toEqual({ ok: false, error: "TOO_MANY_PIXELS" });
  });

  it("rejects SVG and other types whatever they are called", () => {
    expect(checkLogoFile(svgBytes())).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
  });

  it("rejects empty files and files whose header can't be read", () => {
    expect(checkLogoFile(new Uint8Array())).toEqual({ ok: false, error: "EMPTY" });
    expect(checkLogoFile(pngBytes(10, 10).subarray(0, 12))).toEqual({ ok: false, error: "UNREADABLE" });
    expect(checkLogoFile(pngBytes(0, 0))).toEqual({ ok: false, error: "UNREADABLE" });
  });
});
