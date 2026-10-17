import { describe, expect, it } from "vitest";

import { describeMessageStatus, isFinallyFailed, isLinkTemplate } from "./messages";

describe("describeMessageStatus", () => {
  it("follows the channel for sent and finally failed messages", () => {
    expect(describeMessageStatus({ channel: "SMS", status: "SENT", attempts: 1 }).label).toBe("SMS sent");
    expect(describeMessageStatus({ channel: "SMS", status: "FAILED", attempts: 3 }).label).toBe("SMS not sent");
    expect(describeMessageStatus({ channel: "EMAIL", status: "FAILED", attempts: 3 }).label).toBe("Email not sent");
  });

  it("shows a failed message with attempts left as retrying", () => {
    expect(describeMessageStatus({ channel: "SMS", status: "FAILED", attempts: 1 }).label).toBe("Trying again soon");
    expect(isFinallyFailed({ status: "FAILED", attempts: 2 })).toBe(false);
  });

  it("shows replaced and opened messages in plain words", () => {
    expect(describeMessageStatus({ channel: "SMS", status: "REPLACED", attempts: 0 }).label).toBe("Replaced by a newer message");
    expect(describeMessageStatus({ channel: "WHATSAPP_MANUAL", status: "OPENED", attempts: 0 }).label).toBe("WhatsApp opened");
  });
});

describe("isLinkTemplate", () => {
  it("is true only for the order link and price update", () => {
    expect(isLinkTemplate("LINK_CREATED")).toBe(true);
    expect(isLinkTemplate("QUOTE_NEEDS_APPROVAL")).toBe(true);
    expect(isLinkTemplate("READY")).toBe(false);
    expect(isLinkTemplate("WHATSAPP_LINK")).toBe(false);
  });
});
