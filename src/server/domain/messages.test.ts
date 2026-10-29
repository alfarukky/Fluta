import { describe, expect, it } from "vitest";

import type { CustomerMessageTemplate } from "@/lib/messages";

import {
  chooseDestinations,
  composeEmail,
  composeMessageText,
  countSmsParts,
  emailText,
  composeWhatsAppText,
  getBookingSmsCapDecision,
  getCapDayStart,
  getGreetingName,
  getStageMessageTemplate,
  getWhatsAppUrl,
  isClaimable,
  isPlainText,
  isStuckSending,
  toPlainText,
  type MessageWording,
} from "./messages";

const LINK = "https://fluta.app/o/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

const BASE: MessageWording = {
  template: "LINK_CREATED",
  storeName: "FreshFold Laundry",
  customerName: "Aisha Bello",
  orderNumber: "FF-1024",
  fulfilmentType: "DROP_OFF",
  link: LINK,
  linkDomain: "fluta.app",
  storePhone: "+234 803 123 4521",
};

function wording(template: CustomerMessageTemplate, overrides: Partial<MessageWording> = {}): MessageWording {
  const link = template === "LINK_CREATED" || template === "QUOTE_NEEDS_APPROVAL" ? LINK : null;
  return { ...BASE, template, link, ...overrides };
}

describe("composeMessageText", () => {
  it("writes the order link SMS with a greeting, the link, a thank-you, and the safety line", () => {
    expect(composeMessageText(wording("LINK_CREATED"))).toBe(
      `FreshFold Laundry: Hi Aisha, we've received your order FF-1024. Track it here: ${LINK} Thank you for choosing FreshFold Laundry. Real links start with fluta.app`,
    );
  });

  it("writes the price update SMS with no amount", () => {
    const text = composeMessageText(wording("QUOTE_NEEDS_APPROVAL"));
    expect(text).toBe(
      `FreshFold Laundry: Hi Aisha, there's an update to the price of your order FF-1024 that needs your approval. Please review it here: ${LINK} Thank you. Real links start with fluta.app`,
    );
    expect(text).not.toMatch(/NGN|₦|\d{3,},/);
  });

  it("writes Ready for drop-off and pickup orders, ending with the store's phone", () => {
    expect(composeMessageText(wording("READY"))).toBe(
      "FreshFold Laundry: Hi Aisha, your order FF-1024 is ready for collection. Thank you! Questions? Call +234 803 123 4521",
    );
    expect(composeMessageText(wording("READY", { fulfilmentType: "PICKUP_DELIVERY" }))).toBe(
      "FreshFold Laundry: Hi Aisha, your order FF-1024 is ready and will be delivered to you soon. Thank you! Questions? Call +234 803 123 4521",
    );
  });

  it("writes On its way, ending with the store's phone", () => {
    expect(composeMessageText(wording("OUT_FOR_DELIVERY"))).toBe(
      "FreshFold Laundry: Hi Aisha, your order FF-1024 is on its way to you. See you soon! Questions? Call +234 803 123 4521",
    );
  });

  it("puts no link in Ready or On its way", () => {
    for (const template of ["READY", "OUT_FOR_DELIVERY"] as const) {
      expect(composeMessageText(wording(template))).not.toContain("http");
    }
  });

  it("leaves out the phone line when the store has no phone", () => {
    expect(composeMessageText(wording("READY", { storePhone: null }))).toBe(
      "FreshFold Laundry: Hi Aisha, your order FF-1024 is ready for collection. Thank you!",
    );
  });

  it("refuses a link message without a link", () => {
    expect(() => composeMessageText(wording("LINK_CREATED", { link: null }))).toThrow();
  });

  it("starts every SMS with the store's name and uses plain characters only", () => {
    const storeName = "Mama’s “Best” Wash; Ikeja ₦ 🧺";
    for (const template of ["LINK_CREATED", "QUOTE_NEEDS_APPROVAL", "READY", "OUT_FOR_DELIVERY"] as const) {
      const text = composeMessageText(wording(template, { storeName, customerName: "Zoë 🌸 Adé" }));
      expect(text.startsWith('Mama\'s "Best" Wash, Ikeja NGN: Hi Zoe,')).toBe(true);
      expect(text).toContain("FF-1024");
      expect(isPlainText(text)).toBe(true);
      expect(text).not.toContain(";");
    }
  });

  it("keeps each SMS to its expected number of standard parts", () => {
    expect(countSmsParts(composeMessageText(wording("LINK_CREATED")))).toBe(2);
    expect(countSmsParts(composeMessageText(wording("QUOTE_NEEDS_APPROVAL")))).toBe(2);
    expect(countSmsParts(composeMessageText(wording("READY", { fulfilmentType: "PICKUP_DELIVERY" })))).toBe(1);
    expect(countSmsParts(composeMessageText(wording("OUT_FOR_DELIVERY")))).toBe(1);
  });
});

describe("toPlainText", () => {
  it("straightens quotes, spells out the naira sign, and drops emoji and accents", () => {
    expect(toPlainText("Café “Clean” – ₦500; 🎉")).toBe('Cafe "Clean" - NGN 500,');
  });
});

describe("getGreetingName", () => {
  it("greets by the first name", () => {
    expect(getGreetingName("Aisha Bello")).toBe("Aisha");
    expect(getGreetingName("  chinedu  ")).toBe("chinedu");
    expect(getGreetingName("Ngozi-Ann Eze")).toBe("Ngozi-Ann");
  });

  it("says Hi there for a title, an initial, or no usable name", () => {
    for (const name of ["Mrs Okafor", "Dr. Bello", "A. Bello", "", "   ", "08031234567", "🌸"]) {
      expect(getGreetingName(name)).toBeNull();
    }
    expect(composeMessageText(wording("READY", { customerName: "Mrs Okafor" }))).toMatch(/^FreshFold Laundry: Hi there, /);
  });
});

describe("countSmsParts", () => {
  it("counts 160 characters as one part, then 153 per part", () => {
    expect(countSmsParts("a".repeat(160))).toBe(1);
    expect(countSmsParts("a".repeat(161))).toBe(2);
    expect(countSmsParts("a".repeat(306))).toBe(2);
    expect(countSmsParts("a".repeat(307))).toBe(3);
  });
});

describe("composeEmail", () => {
  it("writes the order link email with a greeting, button, thank-you, and safety line", () => {
    const email = composeEmail(wording("LINK_CREATED"));
    expect(email).toEqual({
      subject: "FreshFold Laundry: we've received your order FF-1024",
      paragraphs: [
        "Hi Aisha,",
        "We've received your order FF-1024. You can follow its progress at any time with the button below.",
        "Thank you for choosing FreshFold Laundry. We look forward to taking care of your laundry.",
      ],
      button: { label: "Track your order", url: LINK },
      smallPrint: [
        "Real links from FreshFold Laundry always start with fluta.app.",
        "If you have any questions, call FreshFold Laundry on +234 803 123 4521.",
      ],
    });
    expect(emailText(email)).toContain(`Track your order: ${LINK}`);
  });

  it("writes the price update email with no amount", () => {
    const email = composeEmail(wording("QUOTE_NEEDS_APPROVAL"));
    expect(email.subject).toBe("FreshFold Laundry: please review the price of order FF-1024");
    expect(email.button).toEqual({ label: "Review the price", url: LINK });
    expect(emailText(email)).not.toMatch(/NGN|₦/);
  });

  it("writes Ready and On its way with no button or link", () => {
    const ready = composeEmail(wording("READY", { fulfilmentType: "PICKUP_DELIVERY" }));
    expect(ready.subject).toBe("FreshFold Laundry: your order FF-1024 is ready");
    expect(ready.paragraphs[1]).toBe("Good news: your order FF-1024 is ready and will be delivered to you soon.");
    const onItsWay = composeEmail(wording("OUT_FOR_DELIVERY"));
    expect(onItsWay.paragraphs.at(-1)).toBe("Thank you for choosing FreshFold Laundry. See you soon!");
    for (const email of [ready, onItsWay]) {
      expect(email.button).toBeNull();
      expect(emailText(email)).not.toContain("http");
    }
  });

  it("keeps the customer's own spelling and uses no emoji", () => {
    const email = composeEmail(wording("LINK_CREATED", { customerName: "Zoë Adé" }));
    expect(email.paragraphs[0]).toBe("Hi Zoë,");
    expect(emailText(email)).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("getStageMessageTemplate", () => {
  it("sends Ready and On its way when moving forward", () => {
    expect(getStageMessageTemplate("IN_PROGRESS", "READY")).toBe("READY");
    expect(getStageMessageTemplate("READY", "OUT_FOR_DELIVERY")).toBe("OUT_FOR_DELIVERY");
  });

  it("sends nothing when stepping back, or for other stages", () => {
    expect(getStageMessageTemplate("OUT_FOR_DELIVERY", "READY")).toBeNull();
    expect(getStageMessageTemplate("COMPLETED", "READY")).toBeNull();
    expect(getStageMessageTemplate("COMPLETED", "OUT_FOR_DELIVERY")).toBeNull();
    expect(getStageMessageTemplate("READY", "COMPLETED")).toBeNull();
  });
});

describe("chooseDestinations", () => {
  const input = {
    customerPhone: "+2348031234567",
    customerEmail: "ada@example.com",
    smsEnabled: true,
    emailCopiesEnabled: true,
    smsWithinCap: true,
  };

  it("emails Book and pay's order link even with email copies off, only when alwaysEmail is set", () => {
    const off = { ...input, emailCopiesEnabled: false };
    expect(chooseDestinations(off)).toEqual([{ channel: "SMS", recipient: "+2348031234567" }]);
    expect(chooseDestinations({ ...off, alwaysEmail: false })).toEqual([{ channel: "SMS", recipient: "+2348031234567" }]);
    expect(chooseDestinations({ ...off, alwaysEmail: true })).toEqual([
      { channel: "SMS", recipient: "+2348031234567" },
      { channel: "EMAIL", recipient: "ada@example.com" },
    ]);
    // The SMS still follows its own rules.
    expect(chooseDestinations({ ...off, smsWithinCap: false, alwaysEmail: true })).toEqual([{ channel: "EMAIL", recipient: "ada@example.com" }]);
  });

  it("sends SMS to a Nigerian number and an email copy", () => {
    expect(chooseDestinations(input)).toEqual([
      { channel: "SMS", recipient: "+2348031234567" },
      { channel: "EMAIL", recipient: "ada@example.com" },
    ]);
  });

  it("sends a foreign number no SMS, but still the email", () => {
    expect(chooseDestinations({ ...input, customerPhone: "+447700900123" })).toEqual([
      { channel: "EMAIL", recipient: "ada@example.com" },
    ]);
  });

  it("decides each channel by its own setting", () => {
    expect(chooseDestinations({ ...input, smsEnabled: false })).toEqual([{ channel: "EMAIL", recipient: "ada@example.com" }]);
    expect(chooseDestinations({ ...input, emailCopiesEnabled: false })).toEqual([
      { channel: "SMS", recipient: "+2348031234567" },
    ]);
    expect(chooseDestinations({ ...input, customerEmail: null })).toEqual([{ channel: "SMS", recipient: "+2348031234567" }]);
  });

  it("sends no SMS past the cap, but still the email", () => {
    expect(chooseDestinations({ ...input, smsWithinCap: false })).toEqual([{ channel: "EMAIL", recipient: "ada@example.com" }]);
  });
});

describe("getBookingSmsCapDecision", () => {
  it("allows booking SMS below the cap and refuses at it", () => {
    expect(getBookingSmsCapDecision(99, 100).allowed).toBe(true);
    expect(getBookingSmsCapDecision(100, 100).allowed).toBe(false);
    expect(getBookingSmsCapDecision(0, 0).allowed).toBe(false);
  });

  it("alerts once, on the message that reaches 80% of the cap", () => {
    const alerts = Array.from({ length: 100 }, (_, sentToday) => getBookingSmsCapDecision(sentToday, 100).alert);
    expect(alerts.filter(Boolean)).toHaveLength(1);
    expect(getBookingSmsCapDecision(79, 100).alert).toBe(true);
    expect(getBookingSmsCapDecision(100, 100).alert).toBe(false);
  });
});

describe("getCapDayStart", () => {
  it("starts the day at midnight in the store's time zone", () => {
    // 23:30 UTC on 16 Oct is 00:30 on 17 Oct in Lagos (UTC+1).
    expect(getCapDayStart(new Date("2026-10-16T23:30:00Z"), "Africa/Lagos").toISOString()).toBe("2026-10-16T23:00:00.000Z");
    // 22:30 UTC is still 16 Oct in Lagos.
    expect(getCapDayStart(new Date("2026-10-16T22:30:00Z"), "Africa/Lagos").toISOString()).toBe("2026-10-15T23:00:00.000Z");
  });
});

describe("isClaimable", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("claims queued and failed messages with attempts left", () => {
    expect(isClaimable({ status: "QUEUED", attempts: 0, lastAttemptAt: null }, now)).toBe(true);
    expect(isClaimable({ status: "FAILED", attempts: 2, lastAttemptAt: minutesAgo(5) }, now)).toBe(true);
  });

  it("never claims a message that has used 3 attempts", () => {
    expect(isClaimable({ status: "FAILED", attempts: 3, lastAttemptAt: minutesAgo(60) }, now)).toBe(false);
    expect(isClaimable({ status: "SENDING", attempts: 3, lastAttemptAt: minutesAgo(60) }, now)).toBe(false);
  });

  it("claims a message stuck in SENDING only after 10 minutes", () => {
    expect(isClaimable({ status: "SENDING", attempts: 1, lastAttemptAt: minutesAgo(9) }, now)).toBe(false);
    expect(isClaimable({ status: "SENDING", attempts: 1, lastAttemptAt: minutesAgo(11) }, now)).toBe(true);
    expect(isStuckSending({ status: "SENDING", attempts: 1, lastAttemptAt: minutesAgo(10) }, now)).toBe(false);
  });

  it("never claims sent, replaced, or opened messages", () => {
    for (const status of ["SENT", "REPLACED", "OPENED"] as const) {
      expect(isClaimable({ status, attempts: 0, lastAttemptAt: null }, now)).toBe(false);
    }
  });
});

describe("WhatsApp", () => {
  it("greets the customer, adding the link when there is one", () => {
    const base = { customerName: "Ada Obi", storeName: "FreshFold Laundry", orderNumber: "FF-1024" };
    expect(composeWhatsAppText({ ...base, link: null })).toBe(
      "Hello Ada Obi, this is FreshFold Laundry about your order FF-1024.",
    );
    expect(composeWhatsAppText({ ...base, link: LINK })).toBe(
      `Hello Ada Obi, this is FreshFold Laundry about your order FF-1024. You can follow your order here: ${LINK}`,
    );
  });

  it("opens a chat with any country's number", () => {
    expect(getWhatsAppUrl("+447700900123", "Hi there")).toBe("https://wa.me/447700900123?text=Hi%20there");
  });
});
