"use client";

import { TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";

// Shown when loading the payments list fails.
export default function PaymentsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <EmptyState
        icon={TriangleAlertIcon}
        title="We couldn't load your payments"
        description="Check your connection and try again."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </main>
  );
}
