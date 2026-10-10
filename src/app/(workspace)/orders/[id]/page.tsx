import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { OrderSummary } from "@/components/orders/OrderSummary";
import { formatOrderNumber } from "@/lib/orders";
import { orderIdSchema } from "@/schemas/orders";
import { requireStoreMember } from "@/server/auth/session";
import { getOrderSummary } from "@/server/services/order-entry";

export const metadata: Metadata = { title: "Order · Fluta" };

// A simple summary after creating an order; Feature 10 replaces it with the
// full order detail.
export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  const id = orderIdSchema.safeParse((await params).id);
  // Another store's order matches nothing, exactly like a missing one.
  const order = id.success ? await getOrderSummary(member.store.id, id.data) : null;
  if (!order) notFound();

  return (
    <OrderSummary
      order={order}
      displayNumber={formatOrderNumber(order.store, order.orderNumber)}
      timeZone={member.store.timeZone}
    />
  );
}
