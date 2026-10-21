import type { PaystackBank, PaystackClient } from "@/server/integrations/paystack";

// In-memory stand-in for Paystack. Tests never call Paystack: the
// integration setup returns this from getPaystackClient(). Each call is
// recorded, so a test can check that nothing reached Paystack.
export class FakePaystackClient implements PaystackClient {
  readonly calls: string[] = [];
  banks: PaystackBank[] = [
    { name: "Access Bank", code: "044" },
    { name: "Guaranty Trust Bank", code: "058" },
    { name: "Test Bank", code: "001" },
  ];

  async listBanks(): Promise<PaystackBank[]> {
    this.calls.push("listBanks");
    return [...this.banks];
  }

  reset(): void {
    this.calls.length = 0;
  }
}
