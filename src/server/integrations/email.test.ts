import { beforeEach, describe, expect, it, vi } from "vitest";

// Resend is mocked: no test calls the real API.
const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
const staging = vi.hoisted(() => ({ current: false }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ RESEND_API_KEY: "re_test_placeholder", EMAIL_FROM: "Fluta <noreply@example.com>" }),
  isStaging: () => staging.current,
}));

const { getMailer } = await import("./email");

const MESSAGE = { to: "ada@example.com", subject: "FreshFold: hello", text: "Hello", html: "<p>Hello</p>" };

describe("getMailer", () => {
  beforeEach(() => {
    send.mockReset();
    staging.current = false;
  });

  it("sends from EMAIL_FROM with the text and HTML parts", async () => {
    send.mockResolvedValue({ data: { id: "email-1" }, error: null, headers: {} });

    await getMailer().send(MESSAGE);

    expect(send).toHaveBeenCalledWith({ from: "Fluta <noreply@example.com>", ...MESSAGE });
  });

  it("starts the subject with [Staging] on the staging site, and only there", async () => {
    send.mockResolvedValue({ data: { id: "email-1" }, error: null, headers: {} });

    staging.current = true;
    await getMailer().send(MESSAGE);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "[Staging] FreshFold: hello" }));

    staging.current = false;
    await getMailer().send(MESSAGE);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "FreshFold: hello" }));
  });

  it("throws when Resend returns an error, carrying only its code", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "invalid_api_key", statusCode: 403, message: "API key is invalid for ada@example.com" },
      headers: {},
    });

    const failure = await getMailer().send(MESSAGE).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ name: "invalid_api_key" });
    expect(String(failure)).not.toContain("ada@example.com");
  });
});
