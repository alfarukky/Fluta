"use client";

import { ClockIcon, LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";

import { startOnlinePayment, type StartOnlinePaymentResult } from "@/actions/online-payments";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PAYSTACK_EMAIL_HINT } from "@/lib/online-payment";
import type { PayNowOffer } from "@/types/tracking";

interface PayNowCardProps {
  token: string;
  offer: PayNowOffer;
  // The heading's level: h2 on the order page, h3 inside the booking confirmation.
  headingLevel?: "h2" | "h3";
  // Shows the card's sample state only (the design system): never calls the server.
  preview?: boolean;
}

// Pay the full balance due on Paystack's page. The button stays disabled
// from the tap until the browser leaves for checkout. While a recent attempt
// is still pending, the card says so, with Pay again as a secondary link.
export function PayNowCard({ token, offer, headingLevel: Heading = "h2", preview = false }: PayNowCardProps) {
  const id = useId();
  const router = useRouter();
  const [email, setEmail] = useState(offer.email);
  const [error, setError] = useState<{ message: string; field: boolean } | null>(null);
  const [payingAgain, setPayingAgain] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = pending || leaving;
  const emailId = `${id}-email`;
  const headingId = `${id}-heading`;

  function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || preview) return;
    setError(null);
    startTransition(async () => {
      let result: StartOnlinePaymentResult;
      try {
        result = await startOnlinePayment(token, { email });
      } catch {
        setError({ message: "We couldn't reach Paystack. Check your connection and try again.", field: false });
        return;
      }
      if (!result.ok) {
        setError({ message: result.message, field: "fieldErrors" in result });
        return;
      }
      if (result.checkoutUrl === null) {
        router.refresh();
        return;
      }
      setLeaving(true);
      window.location.assign(result.checkoutUrl);
    });
  }

  if (offer.recentAttempt && !payingAgain) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-component rounded-xl border border-border bg-card p-card">
        <div className="flex items-start gap-3">
          <ClockIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="flex flex-col gap-1">
            <Heading id={headingId} className="type-label text-card-foreground">
              A payment is being confirmed
            </Heading>
            <p className="type-body-sm text-muted-foreground">
              If you&apos;ve paid, this page will update once the store receives it.
            </p>
          </div>
        </div>
        <Button type="button" variant="link" className="self-start" onClick={() => setPayingAgain(true)}>
          Pay again
        </Button>
      </section>
    );
  }

  const fieldError = error?.field ? error.message : undefined;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-component rounded-xl border border-primary/40 bg-primary/5 p-card">
      <Heading id={headingId} className="type-h3 text-foreground">
        Payment due: {offer.amount}
      </Heading>
      <form noValidate onSubmit={pay} className="flex flex-col gap-component">
        <FormField id={emailId} label="Email" hint={PAYSTACK_EMAIL_HINT} error={fieldError}>
          <Input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (error?.field) setError(null);
            }}
            maxLength={254}
            disabled={busy}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={describedBy(emailId, PAYSTACK_EMAIL_HINT, fieldError)}
          />
        </FormField>
        {error && !error.field && (
          <p role="alert" className="type-body-sm rounded-lg border border-error/40 bg-error/10 p-3 text-foreground">
            {error.message}
          </p>
        )}
        <Button type="submit" disabled={busy} aria-disabled={busy} className="self-stretch xs:self-start">
          <LockIcon data-icon="inline-start" aria-hidden />
          {busy ? "Opening Paystack…" : `Pay ${offer.amount}`}
        </Button>
        <p className="type-caption text-muted-foreground">{offer.warning}</p>
      </form>
    </section>
  );
}
