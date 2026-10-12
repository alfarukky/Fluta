import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { OrderDetailSkeleton } from "@/components/orders/OrderDetailSkeleton";
import { orderIdSchema } from "@/schemas/orders";
import { requireStoreMember } from "@/server/auth/session";
import { getOrderDetail, isStoreOrder } from "@/server/services/orders";

export const metadata: Metadata = { title: "Order · Fluta" };

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  // Checked before anything streams, so the response is a real 404. Another
  // store's order matches nothing, exactly like a missing one.
  const id = orderIdSchema.safeParse((await params).id);
  if (!id.success || !(await isStoreOrder(member.store.id, id.data))) notFound();

  return (
    <Suspense fallback={<OrderDetailSkeleton />}>
      <OrderDetailContent storeId={member.store.id} orderId={id.data} timeZone={member.store.timeZone} />
    </Suspense>
  );
}

async function OrderDetailContent({ storeId, orderId, timeZone }: { storeId: string; orderId: string; timeZone: string }) {
  const detail = await getOrderDetail(storeId, orderId);
  if (!detail) notFound();
  return <OrderDetail detail={detail} timeZone={timeZone} />;
}
