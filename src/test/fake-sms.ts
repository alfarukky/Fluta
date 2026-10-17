import type { SmsMessage, SmsProvider } from "@/server/integrations/sms";

// In-memory stand-in for Termii. Tests never send real SMS:
//   vi.mock("@/server/integrations/sms", () => ({ getSmsProvider: () => fakeSms }))
export class FakeSmsProvider implements SmsProvider {
  readonly sent: SmsMessage[] = [];
  failSends = false;
  // Called before each send, e.g. to hold a send open while a test races it.
  beforeSend: (() => Promise<void>) | null = null;
  private nextId = 1;

  async send(message: SmsMessage): Promise<{ providerMessageId: string }> {
    await this.beforeSend?.();
    if (this.failSends) throw new Error("Fake SMS: send failed");
    this.sent.push(message);
    return { providerMessageId: `fake-${this.nextId++}` };
  }

  sentTo(to: string): SmsMessage[] {
    return this.sent.filter((message) => message.to === to);
  }

  reset(): void {
    this.sent.length = 0;
    this.failSends = false;
    this.beforeSend = null;
  }
}
