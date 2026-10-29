import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  resolveSettlementAccount: vi.fn(),
  connectSettlementAccount: vi.fn(),
  changeSettlementAccount: vi.fn(),
  setPayLater: vi.fn(),
}));
vi.mock("@/actions/payment-settings", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PaymentSettingsCard } from "./PaymentSettingsCard";

const BANKS = [
  { id: "1", name: "Access Bank" },
  { id: "9", name: "Guaranty Trust Bank" },
];
const ACCOUNT = { bankName: "Guaranty Trust Bank", accountName: "AMINA BELLO", last4: "4521", connectedOn: "Tue, 20 Oct 2026" };
const PAYSTACK_FEES = "Paystack's fees are taken from each online payment before it reaches your bank.";

afterEach(() => vi.clearAllMocks());

function renderCard(props: Partial<Parameters<typeof PaymentSettingsCard>[0]> = {}) {
  return render(
    <PaymentSettingsCard
      available
      banks={BANKS}
      storeName="FreshFold Laundry"
      initialAccount={null}
      payLaterEnabled={false}
      {...props}
    />,
  );
}

describe("PaymentSettingsCard", () => {
  it("says so when Paystack isn't set up in this environment", () => {
    renderCard({ available: false });
    expect(screen.getByText("Online payments aren't set up in this environment.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check account" })).toBeNull();
  });

  it("not connected: the connect form with the store name, Paystack's fee note, and no pay later switch", () => {
    renderCard();
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect((screen.getByLabelText("Business name") as HTMLInputElement).value).toBe("FreshFold Laundry");
    expect(screen.getByRole("button", { name: "Check account" })).toBeTruthy();
    expect(screen.getByText(PAYSTACK_FEES)).toBeTruthy();
    expect(screen.queryByText(/Fluta fee/)).toBeNull();
    expect(screen.queryByText("Let customers pay later")).toBeNull();
  });

  it("connected: the bank, account name, last 4 digits, date, Paystack's fee note, and pay later switch", () => {
    renderCard({ initialAccount: ACCOUNT });
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText(/Guaranty Trust Bank · AMINA BELLO ·/).textContent).toContain("•••• 4521");
    expect(screen.getByText("Connected Tue, 20 Oct 2026")).toBeTruthy();
    expect(screen.getByText(PAYSTACK_FEES)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Let customers pay later" })).toBeTruthy();
  });

  it("change: asks for the password once the account is checked", async () => {
    actions.resolveSettlementAccount.mockResolvedValue({
      ok: true,
      message: "Account found",
      values: { bankName: "Access Bank", accountName: "AMINA BELLO" },
    });
    renderCard({ initialAccount: ACCOUNT });
    fireEvent.click(screen.getByRole("button", { name: "Change bank account" }));
    expect(screen.queryByLabelText("Business name")).toBeNull();
    expect(screen.queryByLabelText("Your password")).toBeNull();

    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "0987651234" } });
    fireEvent.click(screen.getByRole("button", { name: "Check account" }));

    await waitFor(() => expect(screen.getByText("AMINA BELLO")).toBeTruthy());
    expect(screen.getByLabelText("Your password")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Yes, change to this account" })).toBeTruthy();
  });

  it("shows a problem loading the bank list instead of the form", () => {
    renderCard({ banks: null });
    expect(screen.getByRole("alert").textContent).toContain("couldn't load the list of banks");
    expect(screen.queryByRole("button", { name: "Check account" })).toBeNull();
  });
});
