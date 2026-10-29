import { ArrowLeftIcon, ReceiptTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { PrintButton } from "@/components/receipts/PrintButton";
import { Receipt } from "@/components/receipts/Receipt";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { getOrderPath } from "@/lib/order-links";
import { requireStoreMember } from "@/server/auth/session";
import { getReceiptData } from "@/server/services/receipts";

export const metadata: Metadata = { title: "Receipt · Fluta" };

// Owners and staff only, checked here as well as in getReceiptData (one
// lookup per request). Riders are refused.
export default async function ReceiptPage({ params }: PageProps<"/orders/[id]/receipt">) {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  const { id } = await params;
  const result = await getReceiptData(id);
  if (result.kind === "DENIED") return <AccessDenied reason={result.reason} />;
  if (result.kind === "NOT_FOUND") notFound();

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-component print:hidden">
        <Button asChild variant="link" className="h-auto px-0">
          <Link href={getOrderPath(id)}>
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            Back to order
          </Link>
        </Button>
        {result.kind === "RECEIPT" && <PrintButton />}
      </div>

      {result.kind === "RECEIPT" ? (
        <Receipt receipt={result.receipt} />
      ) : (
        <EmptyState icon={ReceiptTextIcon} title={result.orderNumber} description={result.message} />
      )}
    </main>
  );
}
