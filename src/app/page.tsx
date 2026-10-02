import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { isDevelopment } from "@/lib/env";

// Placeholder home page until the product screens exist.
export default function Home() {
  return (
    <main className="page-container flex flex-1 flex-col items-center justify-center gap-6 py-section text-center">
      <Logo size="lg" />
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="type-display">Laundry operations, made simple</h1>
        <p className="type-body text-muted-foreground">
          Orders, pickups, quotes and payments for independent laundry stores,
          all in one place. Coming soon.
        </p>
      </div>
      {isDevelopment() && (
        <Button asChild variant="outline">
          <Link href="/design-system">
            View the design system
            <ArrowRightIcon data-icon="inline-end" aria-hidden />
          </Link>
        </Button>
      )}
    </main>
  );
}
