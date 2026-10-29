"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { confirmReturnedPayment } from "@/actions/online-payments";

interface ConfirmingPaymentProps {
  token: string;
  reference: string;
  // "/o/{token}": where the page goes once the payment is settled.
  orderPath: string;
  // Shows the card's sample state only (the design system): never calls the server.
  preview?: boolean;
}

const RETRIES = 2;
const RETRY_DELAY_MS = 3_000;

// Back from Paystack while the payment is still PENDING. The return itself
// never changes anything: this asks Fluta to check with Paystack once (and
// twice more, a few seconds apart, while Paystack says it is in progress),
// then shows the order as it now is. If it still isn't confirmed, the
// webhook or the scheduled check finishes it.
export function ConfirmingPayment({ token, reference, orderPath, preview = false }: ConfirmingPaymentProps) {
  const router = useRouter();
  const [stillConfirming, setStillConfirming] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (preview || started.current) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt <= RETRIES && !cancelled; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        let status: Awaited<ReturnType<typeof confirmReturnedPayment>>;
        try {
          status = await confirmReturnedPayment(token, reference);
        } catch {
          status = "PENDING";
        }
        if (status !== "PENDING") break;
      }
      if (cancelled) return;
      setStillConfirming(true);
      router.replace(orderPath);
      router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [token, reference, orderPath, router, preview]);

  return (
    <section
      aria-labelledby="confirming-payment-heading"
      aria-live="polite"
      className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-card"
    >
      <LoaderCircleIcon className="mt-0.5 size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
      <div className="flex flex-col gap-1">
        <h2 id="confirming-payment-heading" className="type-label text-foreground">
          {stillConfirming ? "We're still confirming your payment" : "Confirming your payment…"}
        </h2>
        <p className="type-body-sm text-muted-foreground">This page will update once the store receives it.</p>
      </div>
    </section>
  );
}
