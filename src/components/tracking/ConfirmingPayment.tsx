import { LoaderCircleIcon } from "lucide-react";

// Back from Paystack while the payment is still PENDING. The return never
// changes anything by itself: the payment counts only once Fluta confirms it
// with Paystack (the webhook or a verify call, Phase 4).
export function ConfirmingPayment() {
  return (
    <section
      aria-labelledby="confirming-payment-heading"
      aria-live="polite"
      className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-card"
    >
      <LoaderCircleIcon className="mt-0.5 size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
      <div className="flex flex-col gap-1">
        <h2 id="confirming-payment-heading" className="type-label text-foreground">
          Confirming your payment…
        </h2>
        <p className="type-body-sm text-muted-foreground">This page will update once the store receives it.</p>
      </div>
    </section>
  );
}
