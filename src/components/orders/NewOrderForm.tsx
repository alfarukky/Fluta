"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { createOrder } from "@/actions/orders";
import { Button } from "@/components/ui/button";
import type { OrderEntryArea, OrderEntryService } from "@/types/orders";

import { CustomerSection } from "./CustomerSection";
import { LinesSection } from "./LinesSection";
import { OrderDetailsSection, type OrderEntrySettings } from "./OrderDetailsSection";
import { emptyDraft, reviewDraft, toCreateOrderRequest, type OrderDraft } from "./order-draft";
import { ReviewSection } from "./ReviewSection";

interface NewOrderFormProps {
  services: OrderEntryService[];
  areas: OrderEntryArea[];
  settings: OrderEntrySettings;
}

// Customer → Order details → Lines → Review → Create, on one page.
export function NewOrderForm({ services, areas, settings }: NewOrderFormProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<OrderDraft>(() =>
    emptyDraft(settings.dropOffEnabled ? "DROP_OFF" : "PICKUP_DELIVERY"),
  );
  // One ID for as long as this form is open: sending it twice (a double tap,
  // a retry after a lost response) returns the same order.
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState(false);

  const review = reviewDraft(draft, services, areas);

  function change(update: Partial<OrderDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || created) return;
    const request = toCreateOrderRequest(draft, clientRequestId, areas);

    startTransition(async () => {
      const result = await createOrder(request);
      if (result.ok) {
        setCreated(true);
        toast.success(result.message);
        router.push(`/orders/${result.orderId}`);
        return;
      }
      setErrors(result.fieldErrors ?? {});
      toast.error(result.message);
    });
  }

  const busy = pending || created;

  return (
    <form onSubmit={submit} className="flex flex-col gap-section" noValidate>
      <CustomerSection draft={draft} onChange={change} errors={errors} />
      <OrderDetailsSection draft={draft} onChange={change} errors={errors} areas={areas} settings={settings} />
      <LinesSection draft={draft} onChange={change} errors={errors} services={services} review={review} />
      <ReviewSection review={review} showCharge={draft.fulfilmentType === "PICKUP_DELIVERY"} />

      <div className="flex flex-col gap-component xs:flex-row xs:justify-end">
        <Button type="submit" size="lg" disabled={busy} aria-busy={busy || undefined} className="w-full xs:w-auto">
          {busy ? "Creating order…" : "Create order"}
        </Button>
      </div>
    </form>
  );
}
