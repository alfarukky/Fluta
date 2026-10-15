import { PlusIcon, SearchXIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { OrderFilters } from "@/components/orders/OrderFilters";
import { OrderList } from "@/components/orders/OrderList";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { getNavItem } from "@/components/workspace/nav-items";
import { PageHeader } from "@/components/workspace/PageHeader";
import { orderListFiltersSchema, toOrderListSearch } from "@/schemas/orders";
import { requireStoreMember } from "@/server/auth/session";
import { getOrderListPage } from "@/server/services/orders";

export const metadata: Metadata = { title: "Orders · Fluta" };

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  // Invalid or unknown values fall back to the defaults.
  const filters = orderListFiltersSchema.parse(await searchParams);
  const search = toOrderListSearch(filters);
  const page = await getOrderListPage(member.store, filters, new Date());

  const newOrder = (
    <Button asChild>
      <Link href="/orders/new">
        <PlusIcon data-icon="inline-start" aria-hidden />
        New order
      </Link>
    </Button>
  );

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader title="Orders" description="Every order, newest first." actions={newOrder} />

      {/* Keyed by the address, so the search box and loaded rows reset when it changes. */}
      <OrderFilters key={`filters${search}`} filters={filters} />

      {page.rows.length === 0 ? (
        search ? (
          <EmptyState
            icon={SearchXIcon}
            title="No orders match these filters"
            description="Try another search, or clear the filters to see every order."
            action={
              <Button asChild variant="outline">
                <Link href="/orders">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={getNavItem("/orders").icon}
            title="No orders yet"
            description="Create your first order when a customer drops off, calls, or messages you."
            action={newOrder}
          />
        )
      ) : (
        <OrderList key={`list${search}`} filters={filters} initialRows={page.rows} initialCursor={page.nextCursor} />
      )}
    </main>
  );
}
