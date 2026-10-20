import { SearchXIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { PaymentFilters } from "@/components/payments/PaymentFilters";
import { PaymentList } from "@/components/payments/PaymentList";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getNavItem } from "@/components/workspace/nav-items";
import { PageHeader } from "@/components/workspace/PageHeader";
import { formatNaira } from "@/lib/money";
import {
  DEFAULT_PAYMENT_LIST_FILTERS,
  PAYMENT_DATE_RANGE_LABELS,
  PAYMENT_TOTALS_LABELS,
  paymentListFiltersSchema,
  toPaymentListSearch,
} from "@/schemas/payments";
import { requireStoreMember } from "@/server/auth/session";
import { getPaymentsPageData } from "@/server/services/payments";
import type { PaymentTotals } from "@/types/payments";

export const metadata: Metadata = { title: "Payments · Fluta" };

// Owners and staff, from the Payments menu item.
export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  // Invalid or unknown values fall back to the defaults.
  const filters = paymentListFiltersSchema.parse(await searchParams);
  const search = toPaymentListSearch(filters);
  const now = new Date();
  // Totals are financial figures: owners only (decided in the service).
  const { page, totals } = await getPaymentsPageData(member.store, member.membership.role, filters, now);
  const filtered = filters.method !== null || filters.source !== null;
  const period = PAYMENT_DATE_RANGE_LABELS[filters.date];

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader title="Payments" description="Payments received, newest first, by when they were confirmed." />

      {/* Keyed by the address, so the loaded rows reset when it changes. */}
      <PaymentFilters key={`filters${search}`} filters={filters} />

      {totals && <PaymentTotalsCard totals={totals} label={PAYMENT_TOTALS_LABELS[filters.date]} />}

      {page.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchXIcon}
            title="No payments match these filters"
            description="Try another method or source, or clear the filters."
            action={
              <Button asChild variant="outline">
                <Link href={`/payments${toPaymentListSearch({ ...DEFAULT_PAYMENT_LIST_FILTERS, date: filters.date })}`}>
                  Clear filters
                </Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={getNavItem("/payments").icon}
            title={`No payments ${filters.date === "today" ? "today" : `in the ${period.toLowerCase()}`}`}
            description="Payments show here once they are recorded on an order."
          />
        )
      ) : (
        <PaymentList key={`list${search}`} filters={filters} initialRows={page.rows} initialCursor={page.nextCursor} />
      )}
    </main>
  );
}

// Confirmed payments only: a voided payment counts ₦0.
function PaymentTotalsCard({ totals, label }: { totals: PaymentTotals; label: string }) {
  const items = [
    { label: "Collected at the store", value: totals.storeCollectedKobo },
    { label: "Paid online", value: totals.onlineKobo },
    { label: "Total received", value: totals.storeCollectedKobo + totals.onlineKobo },
  ];
  return (
    <Card aria-label={label}>
      <CardContent className="flex flex-col gap-component">
        <p className="type-label text-foreground">{label}</p>
        <dl className="grid grid-cols-1 gap-component xs:grid-cols-3">
          {items.map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5">
              <dt className="type-caption text-muted-foreground">{item.label}</dt>
              <dd className="type-h3 text-foreground">{formatNaira(item.value)}</dd>
            </div>
          ))}
        </dl>
        <p className="type-caption text-muted-foreground">Confirmed payments only. Voided payments aren&apos;t counted.</p>
      </CardContent>
    </Card>
  );
}
