import { SearchXIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";

// The same for an order that doesn't exist and for another store's, so the
// page never reveals that an order exists elsewhere.
export default function OrderNotFound() {
  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <EmptyState
        icon={SearchXIcon}
        title="Order not found"
        description="Check the link, or find the order in your orders list."
        action={
          <Button asChild variant="outline">
            <Link href="/orders">All orders</Link>
          </Button>
        }
      />
    </main>
  );
}
