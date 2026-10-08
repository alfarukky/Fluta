import { describe, expect, it } from "vitest";

import { escapeHtml, renderEmailHtml } from "./email-layout";
import { buildInvitationEmail, buildPasswordResetEmail } from "./emails";

const URL_WITH_QUERY = "https://fluta.example/invite/abc?x=1&y=2";

describe("renderEmailHtml", () => {
  it("escapes every value, so names typed by owners can't add markup", () => {
    const html = renderEmailHtml({
      preview: "<b>preview</b>",
      heading: `Mama's <script>alert(1)</script> Laundry`,
      paragraphs: ['Say "hi" & <img src=x onerror=alert(1)>'],
      button: { label: "Go <now>", url: `https://x.example/"onmouseover="alert(1)` },
      smallPrint: ["<i>small</i>"],
      footer: "<u>footer</u>",
    });
    expect(html).not.toMatch(/<script|<img|<b>|<i>|<u>|"onmouseover/);
    expect(html).toContain("Mama&#39;s &lt;script&gt;alert(1)&lt;/script&gt; Laundry");
    expect(html).toContain("Say &quot;hi&quot; &amp; &lt;img");
  });

  it("links the button and the copyable fallback to the same URL", () => {
    const html = renderEmailHtml({
      preview: "p",
      heading: "h",
      paragraphs: [],
      button: { label: "Open", url: URL_WITH_QUERY },
      smallPrint: [],
      footer: "f",
    });
    expect(html.match(/href="https:\/\/fluta\.example\/invite\/abc\?x=1&amp;y=2"/g)).toHaveLength(2);
  });

  it("escapes &, <, >, quotes", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("buildInvitationEmail", () => {
  const email = buildInvitationEmail({
    to: "new@x.example",
    storeName: "FreshFold Laundry",
    inviterName: "Ada Okafor",
    url: URL_WITH_QUERY,
    expiresAt: new Date("2026-10-15T12:00:00Z"),
    timeZone: "Africa/Lagos",
  });

  it("has a plain-text part that starts with the store and carries the link and expiry", () => {
    expect(email.text.split("\n")[0]).toBe("FreshFold Laundry");
    expect(email.text).toContain(URL_WITH_QUERY);
    expect(email.text).toContain("expires in 7 days, on Thursday, 15 October 2026");
  });

  it("has an HTML part with the store as heading, an Accept button, and the expiry", () => {
    expect(email.html).toContain(">FreshFold Laundry</h1>");
    expect(email.html).toContain(">Accept invitation</a>");
    expect(email.html).toContain("Ada Okafor invited you to join FreshFold Laundry on Fluta as staff.");
    expect(email.html).toContain("expires in 7 days, on Thursday, 15 October 2026");
  });
});

describe("buildPasswordResetEmail", () => {
  it("starts with the store's name, or Fluta without one, in both parts", () => {
    const withStore = buildPasswordResetEmail({ to: "a@x.example", storeName: "CleanWave", url: URL_WITH_QUERY });
    expect(withStore.text.split("\n")[0]).toBe("CleanWave");
    expect(withStore.html).toContain(">CleanWave</h1>");
    expect(withStore.html).toContain(">Choose a new password</a>");

    const withoutStore = buildPasswordResetEmail({ to: "a@x.example", storeName: null, url: URL_WITH_QUERY });
    expect(withoutStore.text.split("\n")[0]).toBe("Fluta");
    expect(withoutStore.html).toContain("expires in 1 hour");
  });
});
