import { SearchXIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { PaymentFilters } from "@/components/payments/PaymentFilters";
import { PaymentList } from "@/components/payments/PaymentList";
import { RefundList } from "@/components/payments/RefundList";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getNavItem } from "@/components/workspace/nav-items";
import { PageHeader } from "@/components/workspace/PageHeader";
import type { StoreRole } from "@/generated/prisma/enums";
import { formatNaira } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PAYMENT_LIST_FILTERS,
  PAYMENT_DATE_RANGE_LABELS,
  PAYMENT_TOTALS_LABELS,
  paymentListFiltersSchema,
  toPaymentListSearch,
  type PaymentListFilters,
  type PaymentPageView,
} from "@/schemas/payments";
import { REFUND_TOTAL_LABELS } from "@/schemas/refunds";
import { requireStoreMember } from "@/server/auth/session";
import { getPaymentsPageData, type PaymentListStore } from "@/server/services/payments";
import { getRefundsPageData } from "@/server/services/refunds";
import type { PaymentTotals } from "@/types/payments";

export const metadata: Metadata = { title: "Payments · Fluta" };

// Owners and staff, from the Payments menu item: payments received, or
// refunds paid back (?view=refunds).
export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  // Invalid or unknown values fall back to the defaults.
  const filters = paymentListFiltersSchema.parse(await searchParams);
  const search = toPaymentListSearch(filters);
  const refunds = filters.view === "refunds";

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader
        title="Payments"
        description={
          refunds
            ? "Refunds the store paid back, newest first, by when they were recorded."
            : "Payments received, newest first, by when they were confirmed."
        }
      />

      <ViewSwitch filters={filters} />

      {/* Keyed by the address, so the loaded rows reset when it changes. */}
      <PaymentFilters key={`filters${search}`} filters={filters} />

      {refunds ? (
        <RefundsView store={member.store} role={member.membership.role} filters={filters} search={search} />
      ) : (
        <PaymentsView store={member.store} role={member.membership.role} filters={filters} search={search} />
      )}
    </main>
  );
}

const VIEWS: { view: PaymentPageView; label: string }[] = [
  { view: "payments", label: "Payments" },
  { view: "refunds", label: "Refunds" },
];

// Switching view keeps the date filter; method and source are payments only.
function ViewSwitch({ filters }: { filters: PaymentListFilters }) {
  return (
    <nav aria-label="Payments or refunds" className="border-b border-border">
      <ul className="-mb-px flex gap-6">
        {VIEWS.map(({ view, label }) => {
          const current = filters.view === view;
          const href = `/payments${toPaymentListSearch({ ...DEFAULT_PAYMENT_LIST_FILTERS, view, date: filters.date })}`;
          return (
            <li key={view}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "type-label flex h-11 items-center border-b-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  current ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

interface ViewProps {
  store: PaymentListStore;
  role: StoreRole;
  filters: PaymentListFilters;
  search: string;
}

async function PaymentsView({ store, role, filters, search }: ViewProps) {
  // Totals are financial figures: owners only (decided in the service).
  const { page, totals } = await getPaymentsPageData(store, role, filters, new Date());
  const filtered = filters.method !== null || filters.source !== null;
  const period = PAYMENT_DATE_RANGE_LABELS[filters.date];

  return (
    <>
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
    </>
  );
}

async function RefundsView({ store, role, filters, search }: ViewProps) {
  // The total is a financial figure: owners only (decided in the service).
  const { page, totalKobo } = await getRefundsPageData(store, role, filters.date, new Date());
  const period = PAYMENT_DATE_RANGE_LABELS[filters.date];

  return (
    <>
      {totalKobo !== null && <RefundTotalCard totalKobo={totalKobo} label={REFUND_TOTAL_LABELS[filters.date]} />}

      {page.rows.length === 0 ? (
        <EmptyState
          icon={getNavItem("/payments").icon}
          title={`No refunds ${filters.date === "today" ? "today" : `in the ${period.toLowerCase()}`}`}
          description="Refunds show here once they are recorded on an order."
        />
      ) : (
        <RefundList key={`refunds${search}`} filters={filters} initialRows={page.rows} initialCursor={page.nextCursor} />
      )}
    </>
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

// Refunds that aren't voided only.
function RefundTotalCard({ totalKobo, label }: { totalKobo: number; label: string }) {
  return (
    <Card aria-label={label}>
      <CardContent className="flex flex-col gap-component">
        <dl className="flex flex-col gap-0.5">
          <dt className="type-label text-foreground">{label}</dt>
          <dd className="type-h3 text-foreground">{formatNaira(totalKobo)}</dd>
        </dl>
        <p className="type-caption text-muted-foreground">Voided refunds aren&apos;t counted.</p>
      </CardContent>
    </Card>
  );
}
