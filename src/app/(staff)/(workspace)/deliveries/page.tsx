import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { ComingUpSection } from "@/components/deliveries/ComingUpSection";
import { DeliveryCardItem } from "@/components/deliveries/DeliveryCardItem";
import { EmptyState } from "@/components/shared/EmptyState";
import { getNavItem } from "@/components/workspace/nav-items";
import { PageHeader } from "@/components/workspace/PageHeader";
import { requireStoreMember } from "@/server/auth/session";
import { getComingUp, getDeliveries } from "@/server/services/deliveries";
import type { DeliveryCard } from "@/types/deliveries";

export const metadata: Metadata = { title: "Deliveries · Fluta" };

// Today's pickups and deliveries, then "Coming up" (the next 7 days, for
// planning only) at the bottom. The only workspace page riders may open
// ({ allowRider: true }); owners and staff use it too.
export default async function DeliveriesPage() {
  const member = await requireStoreMember({ allowRider: true });
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  const now = new Date();
  const [{ pickups, onTheWay, readyToDeliver }, comingUp] = await Promise.all([
    getDeliveries(member.store, now),
    getComingUp(member.store, now),
  ]);
  const linkToOrder = member.membership.role !== "RIDER";
  const empty = pickups.length === 0 && onTheWay.length === 0 && readyToDeliver.length === 0;

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader title="Deliveries" description="Today's pickups and deliveries." />

      {empty ? (
        <EmptyState
          icon={getNavItem("/deliveries").icon}
          title="No pickups or deliveries right now."
          description="Pickups scheduled for today and orders ready to deliver show up here."
        />
      ) : (
        <>
          <DeliverySection title="Pickups" cards={pickups} linkToOrder={linkToOrder} />
          <DeliverySection title="On the way" cards={onTheWay} linkToOrder={linkToOrder} />
          <DeliverySection title="Ready to deliver" cards={readyToDeliver} linkToOrder={linkToOrder} />
        </>
      )}

      <ComingUpSection comingUp={comingUp} />
    </main>
  );
}

function DeliverySection({ title, cards, linkToOrder }: { title: string; cards: DeliveryCard[]; linkToOrder: boolean }) {
  const headingId = `deliveries-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-component">
      <h2 id={headingId} className="type-h2 text-foreground">
        {title} <span className="type-body text-muted-foreground">({cards.length})</span>
      </h2>
      {cards.length === 0 ? (
        <p className="type-body-sm text-muted-foreground">None right now.</p>
      ) : (
        <ul className="flex flex-col gap-component">
          {cards.map((card) => (
            <DeliveryCardItem key={card.orderId} card={card} linkToOrder={linkToOrder} />
          ))}
        </ul>
      )}
    </section>
  );
}
