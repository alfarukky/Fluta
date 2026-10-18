"use client";

import { PhoneIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { markDelivered, markPickedUp, sendOutForDelivery, type DeliveryActionResult } from "@/actions/deliveries";
import { OutOfAreaBadge } from "@/components/orders/OrderBadges";
import { OpenInMapsButton } from "@/components/shared/OpenInMapsButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPickupWindow } from "@/lib/pickup-schedule";
import { formatCalendarDate } from "@/lib/time";
import type { DeliveryCard, PickupCard } from "@/types/deliveries";

// One job on the Deliveries view: who, where, when (pickups only), a Call
// link, Open in Maps when the customer shared a location, and one big button
// for the next step. Riders see the order number as
// plain text; owners and staff get a link to the order.

const NEXT_STEP: Record<DeliveryCard["stage"], { label: string; action: (orderId: string) => Promise<DeliveryActionResult> }> =
  {
    PICKUP_SCHEDULED: { label: "Mark picked up", action: markPickedUp },
    READY: { label: "Out for delivery", action: sendOutForDelivery },
    OUT_FOR_DELIVERY: { label: "Mark delivered", action: markDelivered },
  };

interface DeliveryCardItemProps {
  card: DeliveryCard | PickupCard;
  linkToOrder: boolean;
}

export function DeliveryCardItem({ card, linkToOrder }: DeliveryCardItemProps) {
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<{ message: string; contactStore: boolean } | null>(null);
  const step = NEXT_STEP[card.stage];
  const pickup = card.stage === "PICKUP_SCHEDULED" ? (card as PickupCard) : null;

  function move() {
    setProblem(null);
    startTransition(async () => {
      const result = await step.action(card.orderId);
      if (result.ok) {
        toast.success(`${card.orderNumber}: ${result.message}`);
        return;
      }
      // A move the rules refuse (a price update waiting for the customer):
      // the reason, and who can sort it out.
      setProblem({ message: result.message, contactStore: result.code === "NOT_ALLOWED" });
    });
  }

  return (
    <li className="flex flex-col gap-component rounded-lg border border-border bg-card p-card md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {linkToOrder ? (
            <Link
              href={`/orders/${card.orderId}`}
              className="type-label text-primary underline-offset-4 hover:underline"
            >
              {card.orderNumber}
            </Link>
          ) : (
            <span className="type-label text-muted-foreground">{card.orderNumber}</span>
          )}
          {pickup?.isOverdue && <Badge variant="error">Overdue</Badge>}
        </div>
        <p className="type-h3 break-words text-foreground">{card.customerName}</p>
        <p className="type-body-sm break-words text-foreground">{card.address ?? "No address given"}</p>
        <div className="flex flex-wrap items-center gap-2">
          {card.areaName && <span className="type-body-sm text-muted-foreground">{card.areaName}</span>}
          {card.isOutOfArea && <OutOfAreaBadge />}
        </div>
        {pickup && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-body-sm text-foreground">
              {pickup.isOverdue ? formatCalendarDate(pickup.scheduledDate) : "Today"}
              {pickup.windowStart && pickup.windowEnd
                ? `, ${formatPickupWindow({ start: pickup.windowStart, end: pickup.windowEnd })}`
                : ""}
            </span>
            {pickup.isOutsideSchedule && <Badge variant="warning">Outside normal schedule</Badge>}
          </div>
        )}
        {problem && (
          <p role="alert" className="type-body-sm text-error">
            {problem.message}
            {problem.contactStore && " Contact the store."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 xs:flex-row md:shrink-0">
        <Button asChild variant="outline" className="h-12 xs:flex-1 md:w-28 md:flex-none">
          <a href={`tel:${card.customerPhone}`} aria-label={`Call ${card.customerName}`}>
            <PhoneIcon data-icon="inline-start" aria-hidden />
            Call
          </a>
        </Button>
        {card.location && <OpenInMapsButton location={card.location} className="h-12 xs:flex-1 md:w-40 md:flex-none" />}
        <Button className="h-12 xs:flex-[2] md:w-44 md:flex-none" onClick={move} disabled={pending}>
          {pending ? "Saving…" : step.label}
        </Button>
      </div>
    </li>
  );
}
