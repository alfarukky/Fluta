import type { PaystackBank, PaystackClient, PaystackSubaccount, SettlementAccountDetails } from "@/server/integrations/paystack";
// Not from paystack.ts: the integration setup replaces that module with this
// fake, so importing a value from it here would never finish loading.
import { PaystackError } from "@/server/integrations/paystack-error";

// In-memory stand-in for Paystack. Tests never call Paystack: the
// integration setup returns this from getPaystackClient(). Each call is
// recorded, so a test can check that nothing reached Paystack.
export class FakePaystackClient implements PaystackClient {
  readonly calls: string[] = [];
  banks: PaystackBank[] = [
    { id: "1", name: "Access Bank", code: "044" },
    { id: "9", name: "Guaranty Trust Bank", code: "058" },
    { id: "100", name: "Test Bank", code: "001" },
    // Two banks sharing a code, as in Paystack's real list.
    { id: "635", name: "Goodnews Microfinance Bank", code: "50739" },
    { id: "792", name: "Prospa Capital Microfinance Bank", code: "50739" },
  ];
  // Account holders by "bankCode:accountNumber". Anything else fails to
  // resolve, as Paystack does (HTTP 422).
  accounts = new Map<string, string>([
    ["058:0123454521", "AMINA BELLO"],
    ["044:0987651234", "AMINA BELLO"],
    ["001:0000000001", "MUSA BELLO"],
  ]);
  readonly subaccounts = new Map<string, PaystackSubaccount>();
  // Set to make the next matching calls throw.
  failNext: Partial<Record<"resolveAccount" | "createSubaccount" | "updateSubaccount", PaystackError>> = {};
  private nextCode = 1;

  async listBanks(): Promise<PaystackBank[]> {
    this.calls.push("listBanks");
    return [...this.banks];
  }

  async resolveAccount({ bankCode, accountNumber }: SettlementAccountDetails): Promise<{ accountName: string }> {
    this.calls.push("resolveAccount");
    this.throwIfFailing("resolveAccount");
    const accountName = this.accounts.get(`${bankCode}:${accountNumber}`);
    if (!accountName) throw new PaystackError("HTTP 422");
    return { accountName };
  }

  async createSubaccount(
    input: SettlementAccountDetails & { businessName: string; primaryContactEmail: string },
  ): Promise<PaystackSubaccount> {
    this.calls.push("createSubaccount");
    this.throwIfFailing("createSubaccount");
    const subaccount: PaystackSubaccount = {
      subaccountCode: `ACCT_fake${this.nextCode++}`,
      businessName: input.businessName,
      settlementBank: this.bankName(input.bankCode),
      accountName: this.accounts.get(`${input.bankCode}:${input.accountNumber}`) ?? null,
      accountNumberLast4: input.accountNumber.slice(-4),
      percentageCharge: 0,
      active: true,
      isVerified: false,
    };
    this.subaccounts.set(subaccount.subaccountCode, subaccount);
    return { ...subaccount };
  }

  async updateSubaccount(code: string, update: SettlementAccountDetails | { active: false }): Promise<PaystackSubaccount> {
    this.calls.push("updateSubaccount");
    this.throwIfFailing("updateSubaccount");
    const current = this.subaccounts.get(code);
    if (!current) throw new PaystackError("HTTP 404");
    const next: PaystackSubaccount =
      "active" in update
        ? { ...current, active: false }
        : {
            ...current,
            settlementBank: this.bankName(update.bankCode),
            accountName: this.accounts.get(`${update.bankCode}:${update.accountNumber}`) ?? null,
            accountNumberLast4: update.accountNumber.slice(-4),
          };
    this.subaccounts.set(code, next);
    return { ...next };
  }

  async fetchSubaccount(code: string): Promise<PaystackSubaccount> {
    this.calls.push("fetchSubaccount");
    const current = this.subaccounts.get(code);
    if (!current) throw new PaystackError("HTTP 404");
    return { ...current };
  }

  reset(): void {
    this.calls.length = 0;
    this.subaccounts.clear();
    this.failNext = {};
  }

  private bankName(code: string): string {
    return this.banks.find((bank) => bank.code === code)?.name ?? "Unknown bank";
  }

  private throwIfFailing(method: keyof FakePaystackClient["failNext"]): void {
    const error = this.failNext[method];
    if (!error) return;
    delete this.failNext[method];
    throw error;
  }
}
