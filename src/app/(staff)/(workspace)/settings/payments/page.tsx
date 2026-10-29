import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { PaymentSettingsCard } from "@/components/settings/PaymentSettingsCard";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { PageHeader } from "@/components/workspace/PageHeader";
import { formatCalendarDate, getLocalDateKey } from "@/lib/time";
import { requireStoreMember } from "@/server/auth/session";
import { getPaymentSettings, listSettlementBanks } from "@/server/services/payment-settings";

export const metadata: Metadata = { title: "Payments · Fluta" };

// Settings → Payments (plan section 4). Owner only, checked here: the
// actions check again for themselves.
export default async function PaymentSettingsPage() {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  const settings = await getPaymentSettings(member.store.id);
  const banks = settings.available ? await listSettlementBanks() : null;
  const account = settings.connected;

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <div className="flex flex-col gap-section">
        <PageHeader title="Payments" description="Get paid online, straight into your bank account." />
        <SettingsNav />
      </div>

      <div className="grid items-start gap-grid lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-grid lg:col-span-2">
          <PaymentSettingsCard
            available={settings.available}
            banks={banks && banks.map(({ id, name }) => ({ id, name }))}
            storeName={settings.storeName}
            initialAccount={
              account && {
                bankName: account.bankName,
                accountName: account.accountName,
                last4: account.last4,
                connectedOn: formatCalendarDate(getLocalDateKey(account.connectedAt, member.store.timeZone)),
              }
            }
            payLaterEnabled={settings.payLaterEnabled}
          />
        </div>
      </div>
    </main>
  );
}
