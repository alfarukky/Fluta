import { afterEach, describe, expect, it, vi } from "vitest";

import { logger, redactTrackingTokens } from "./logger";

const TOKEN = "Zm9vYmFyYmF6cXV4LXRva2VuLWZvci10ZXN0aW5nLTE";

describe("redactTrackingTokens", () => {
  it("replaces the token in a tracking path, wherever it appears", () => {
    expect(redactTrackingTokens(`GET /o/${TOKEN}`)).toBe("GET /o/[token]");
    expect(redactTrackingTokens(`https://app.fluta.example/o/${TOKEN}/price-update?x=1`)).toBe(
      "https://app.fluta.example/o/[token]/price-update?x=1",
    );
  });

  it("leaves other text alone", () => {
    expect(redactTrackingTokens("/orders/abc and /store/freshfold")).toBe("/orders/abc and /store/freshfold");
  });
});

describe("logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never writes a tracking token, in the message, text, or an error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error(`failed at /o/${TOKEN}`, `/o/${TOKEN}`, new TypeError(`bad /o/${TOKEN}`), 42);
    const written = error.mock.calls[0];
    expect(JSON.stringify(written.map((part) => (part instanceof Error ? `${part.name} ${part.message} ${part.stack}` : part)))).not.toContain(
      TOKEN,
    );
    expect(written[2]).toMatchObject({ name: "TypeError", message: "bad /o/[token]" });
    expect(written[3]).toBe(42);
  });
});
