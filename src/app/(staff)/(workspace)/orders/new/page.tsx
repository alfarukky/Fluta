import { ClipboardXIcon, ShirtIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { NewOrderForm } from "@/components/orders/NewOrderForm";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/PageHeader";
import { STORE_NOT_ACCEPTING_MESSAGE } from "@/schemas/orders";
import { requireStoreMember } from "@/server/auth/session";
import { loadOrderEntry } from "@/server/services/order-entry";

export const metadata: Metadata = { title: "New order · Fluta" };

export default async function NewOrderPage() {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader
        title="New order"
        description="For orders received at the counter, by phone, or on WhatsApp."
      />
      <NewOrderContent
        storeId={member.store.id}
        timeZone={member.store.timeZone}
        isOwner={member.membership.role === "OWNER"}
        canAcceptNewOrders={member.access.canAcceptNewOrders}
      />
    </main>
  );
}

interface NewOrderContentProps {
  storeId: string;
  timeZone: string;
  isOwner: boolean;
  canAcceptNewOrders: boolean;
}

async function NewOrderContent({
  storeId,
  timeZone,
  isOwner,
  canAcceptNewOrders,
}: NewOrderContentProps) {
  if (!canAcceptNewOrders) {
    return (
      <EmptyState
        icon={ClipboardXIcon}
        title="New orders are paused"
        description={STORE_NOT_ACCEPTING_MESSAGE}
      />
    );
  }

  const entry = await loadOrderEntry(storeId, timeZone, new Date());
  if (entry.services.length === 0) {
    return (
      <EmptyState
        icon={ShirtIcon}
        title="Add a service before creating orders"
        description={
          isOwner
            ? "Orders are priced from your service catalogue. Add your first service to start taking orders."
            : "Orders are priced from the store's service catalogue. Ask the store owner to add a service."
        }
        action={
          isOwner ? (
            <Button asChild>
              <Link href="/services">Go to Services</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const { settings } = entry;
  return (
    <NewOrderForm
      services={entry.services}
      areas={entry.areas}
      settings={{
        dropOffEnabled: settings.dropOffEnabled,
        pickupDeliveryEnabled: settings.pickupDeliveryEnabled,
        schedule: {
          activeDays: settings.activeDays,
          openTime: settings.openTime,
          closeTime: settings.closeTime,
        },
        closedDates: entry.closedDates,
        today: entry.today,
      }}
    />
  );
}
