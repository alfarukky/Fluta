import type { EmailMessage, Mailer } from "@/server/integrations/email";

// In-memory stand-in for the SMTP mailer. Tests never send real email:
//   vi.mock("@/server/integrations/email", () => ({ getMailer: () => fakeMailer }))
export class FakeMailer implements Mailer {
  readonly sent: EmailMessage[] = [];
  failSends = false;

  async send(message: EmailMessage): Promise<void> {
    if (this.failSends) throw new Error("Fake mailer: send failed");
    this.sent.push(message);
  }

  // The last email sent to `to` (normalized addresses), if any.
  lastTo(to: string): EmailMessage | undefined {
    return this.sent.findLast((message) => message.to === to);
  }

  reset(): void {
    this.sent.length = 0;
    this.failSends = false;
  }
}
