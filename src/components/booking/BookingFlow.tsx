"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { createBooking, type BookingActionResult } from "@/actions/booking";
import { prefersReducedMotion, useScrollToFirstError } from "@/components/forms/scroll-to-first-error";
import { Button } from "@/components/ui/button";
import { formatNaira } from "@/lib/money";
import type { BookingOptions, BookingStep } from "@/types/booking";

import { BookingConfirmation } from "./BookingConfirmation";
import { BookingStepper } from "./BookingStepper";
import {
  createDraft,
  fromServerErrors,
  getBookAndPayTotal,
  getSteps,
  reviewBooking,
  toBookingRequest,
  validateStep,
  type BookingDraft,
  type DraftErrors,
} from "./booking-draft";
import { DetailsStep } from "./DetailsStep";
import { FulfilmentStep } from "./FulfilmentStep";
import { PickupStep } from "./PickupStep";
import { ReviewStep } from "./ReviewStep";
import { ServicesStep } from "./ServicesStep";

interface BookingFlowProps {
  slug: string;
  storeName: string;
  options: BookingOptions;
}

interface Confirmed {
  displayNumber: string;
  trackingUrl: string | null;
  draft: BookingDraft;
  // Book and pay whose payment couldn't start: Pay now to try again.
  payNow: { token: string; message: string } | null;
}

// "Book and pay ₦6,200" for Book and pay, otherwise "Confirm booking".
function submitLabel(bookAndPayTotal: number | null, pending: boolean, leaving: boolean): string {
  if (bookAndPayTotal === null) return pending ? "Sending your booking…" : "Confirm booking";
  if (leaving) return "Opening Paystack…";
  return pending ? "Sending your booking…" : `Book and pay ${formatNaira(bookAndPayTotal)}`;
}

export const STEP_TITLES: Record<BookingStep, string> = {
  services: "Choose your services",
  fulfilment: "Drop-off or pickup",
  pickup: "Pickup details",
  details: "Your details",
  review: "Review your booking",
};

// The booking form: one page, one step at a time, with Back and Continue.
// The answers live here, so moving between steps never loses them.
export function BookingFlow({ slug, storeName, options }: BookingFlowProps) {
  const [draft, setDraft] = useState<BookingDraft>(() => createDraft(options));
  const [step, setStep] = useState<BookingStep>("services");
  const [errors, setErrors] = useState<DraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [pending, startTransition] = useTransition();
  // On the way to Paystack's checkout (or the order page): stays disabled.
  const [leaving, setLeaving] = useState(false);
  // Made once when the page opens: sending the same booking again (a double
  // tap, a retry after a lost connection) returns the same order.
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { ref: formRef, scrollToFirstError } = useScrollToFirstError<HTMLFormElement>();
  const stepChanged = useRef(false);

  useEffect(() => {
    requestId.current ??= crypto.randomUUID();
  }, []);

  // A new step starts at its heading, for screen readers and small screens.
  useEffect(() => {
    if (!stepChanged.current) return;
    stepChanged.current = false;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" });
  }, [step, confirmed]);

  const steps = getSteps(draft);
  const index = steps.indexOf(step);
  const review = reviewBooking(draft, options);
  const bookAndPayTotal = getBookAndPayTotal(options, review);
  const busy = pending || leaving;

  function update(patch: Partial<BookingDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    // Fixing an answer clears its message.
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      if ("lines" in patch) for (const key of Object.keys(next)) if (key.startsWith("service")) delete next[key];
      return next;
    });
  }

  function goTo(next: BookingStep) {
    stepChanged.current = true;
    setErrors({});
    setFormError(null);
    setStep(next);
  }

  function showErrors(found: DraftErrors) {
    setErrors(found);
    scrollToFirstError();
  }

  function handleContinue() {
    const found = validateStep(step, draft, options);
    if (Object.keys(found).length > 0) return showErrors(found);
    goTo(steps[index + 1]);
  }

  function handleSubmit() {
    // One request at a time: sending the same booking again gives its order a
    // new tracking link, so only the latest response's link works.
    if (submitting.current) return;
    submitting.current = true;
    const id = requestId.current ?? crypto.randomUUID();
    requestId.current = id;
    setFormError(null);
    startTransition(async () => {
      let result: BookingActionResult;
      try {
        result = await createBooking(slug, toBookingRequest(draft, id));
      } catch {
        result = { ok: false, code: "CREATE_FAILED", message: "We couldn't send your booking. Check your connection and try again." };
      } finally {
        submitting.current = false;
      }
      if (result.ok) {
        // Book and pay: straight to Paystack, or to the order page when this
        // booking's payment is already being confirmed.
        const next =
          result.payment?.kind === "CHECKOUT" ? result.payment.checkoutUrl : result.payment?.kind === "PENDING" ? result.trackingUrl : null;
        if (next) {
          setLeaving(true);
          window.location.assign(next);
          return;
        }
        stepChanged.current = true;
        setConfirmed({
          displayNumber: result.displayNumber,
          trackingUrl: result.trackingUrl,
          draft,
          payNow: result.payment?.kind === "FAILED" ? { token: result.payment.token, message: result.payment.message } : null,
        });
        return;
      }
      // Back to the step with the problem, with every answer kept.
      if (result.step && result.step !== step) {
        stepChanged.current = true;
        setStep(result.step);
      }
      setFormError(result.message);
      const found = fromServerErrors(result.fieldErrors ?? {}, draft);
      setErrors(found);
      if (Object.keys(found).length > 0) scrollToFirstError();
    });
  }

  function startAgain() {
    requestId.current = crypto.randomUUID();
    setDraft(createDraft(options));
    setConfirmed(null);
    goTo("services");
  }

  if (confirmed) {
    return (
      <BookingConfirmation
        headingRef={headingRef}
        storeName={storeName}
        displayNumber={confirmed.displayNumber}
        trackingUrl={confirmed.trackingUrl}
        draft={confirmed.draft}
        review={reviewBooking(confirmed.draft, options)}
        options={options}
        payNow={confirmed.payNow}
        onStartAgain={startAgain}
      />
    );
  }

  const last = step === "review";
  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (last) handleSubmit();
        else handleContinue();
      }}
      className="flex flex-col gap-section"
      aria-labelledby="booking-step-heading"
    >
      <div className="flex flex-col gap-component">
        <BookingStepper current={index} total={steps.length} />
        <h2 id="booking-step-heading" ref={headingRef} tabIndex={-1} className="type-h2 scroll-mt-4 text-foreground outline-none">
          {STEP_TITLES[step]}
        </h2>
      </div>

      {formError && (
        <p role="alert" className="type-body-sm rounded-lg border border-error/40 bg-error/10 p-3 text-foreground">
          {formError}
        </p>
      )}

      {step === "services" && (
        <ServicesStep
          services={options.services}
          lines={draft.lines}
          note={draft.note}
          errors={errors}
          onChange={(lines) => update({ lines })}
          onNoteChange={(note) => update({ note })}
        />
      )}
      {step === "fulfilment" && (
        <FulfilmentStep
          options={options}
          value={draft.fulfilmentType}
          error={errors.fulfilmentType}
          onChange={(fulfilmentType) => update({ fulfilmentType })}
        />
      )}
      {step === "pickup" && <PickupStep options={options} draft={draft} errors={errors} onChange={update} />}
      {step === "details" && <DetailsStep draft={draft} errors={errors} onChange={update} emailRequired={bookAndPayTotal !== null} />}
      {step === "review" && (
        <ReviewStep
          draft={draft}
          options={options}
          review={review}
          onEdit={(target) => goTo(target)}
          storeName={storeName}
          bookAndPay={bookAndPayTotal !== null}
        />
      )}

      <div className="flex flex-col-reverse gap-3 xs:flex-row xs:justify-between">
        {index > 0 ? (
          <Button type="button" variant="outline" onClick={() => goTo(steps[index - 1])} disabled={busy}>
            Back
          </Button>
        ) : (
          <span className="hidden xs:block" />
        )}
        <Button type="submit" disabled={busy} aria-disabled={busy}>
          {last ? submitLabel(bookAndPayTotal, pending, leaving) : "Continue"}
        </Button>
      </div>
    </form>
  );
}
