import { ArrowLeftIcon, LockIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { QuoteEditor } from "@/components/orders/QuoteEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/PageHeader";
import { canReviseQuote } from "@/lib/quotes";
import { orderIdSchema } from "@/schemas/orders";
import { requireStoreMember } from "@/server/auth/session";
import { loadQuoteEditor } from "@/server/services/quotes";

export const metadata: Metadata = { title: "Edit quote · Fluta" };

export default async function EditQuotePage({ params }: PageProps<"/orders/[id]/quote">) {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  // Another store's order matches nothing, exactly like a missing one.
  const id = orderIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const loaded = await loadQuoteEditor(member.store.id, id.data);
  if (!loaded) notFound();

  const { editor, services, areas } = loaded;
  const orderHref = `/orders/${editor.orderId}`;
  const locked = !member.access.canWorkOnExistingOrders || !canReviseQuote(editor.stage);

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <div className="flex flex-col gap-component">
        <Button asChild variant="link" className="h-auto self-start px-0">
          <Link href={orderHref}>
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            Order {editor.displayNumber}
          </Link>
        </Button>
        <PageHeader
          title={editor.approvedTotal === null ? "Price order" : "Edit quote"}
          description={`Order ${editor.displayNumber}. The customer approves every change to the price.`}
        />
      </div>
      {locked ? (
        <EmptyState
          icon={LockIcon}
          title="This quote can't be changed"
          description={
            member.access.canWorkOnExistingOrders
              ? "Quotes can be changed up to Ready. Anything that comes up from delivery onwards is settled outside Fluta."
              : "This store can't work on orders right now."
          }
          action={
            <Button asChild variant="outline">
              <Link href={orderHref}>Back to order</Link>
            </Button>
          }
        />
      ) : (
        <QuoteEditor editor={editor} services={services} areas={areas} />
      )}
    </main>
  );
}
