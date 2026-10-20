"use client";

import { useEffect, useState, type FormEvent } from "react";

import { voidPayment } from "@/actions/payments";
import { useScrollToFirstError } from "@/components/forms/scroll-to-first-error";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { formatNaira, formatNairaInput } from "@/lib/money";
import { describeOverpayment, describePaymentAmount, getOverpayment, type StorePaymentMethod } from "@/lib/payments";
import { VOID_REASON_MAX } from "@/schemas/payments";

import {
  checkPaymentDraft,
  OverpaymentNotice,
  PaymentFields,
  type PaymentDraft,
  type PaymentField,
  type PaymentFieldErrors,
} from "./PaymentFields";
import { useOrderAction } from "./use-order-action";

export interface VoidablePayment {
  id: string;
  amount: number;
  method: StorePaymentMethod;
  reference: string | null;
  note: string | null;
}

interface VoidPaymentButtonProps {
  payment: VoidablePayment;
  // The order's balance once this payment no longer counts (null: no price approved yet).
  balanceAfterVoidKobo: number | null;
}

// Owners only (the server checks again).
export function VoidPaymentButton({ payment, balanceAfterVoidKobo }: VoidPaymentButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="subtle-destructive"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Void payment of ${describePaymentAmount({ ...payment, source: "STORE_COLLECTED" })}`}
        className="h-11 md:h-9"
      >
        Void
      </Button>
      {open && (
        <VoidPaymentDialog payment={payment} balanceAfterVoidKobo={balanceAfterVoidKobo} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

type Mode = "VOID_ONLY" | "REPLACE";

interface PendingConfirmation {
  amountKobo: number;
  excessKobo: number;
  message: string;
}

function VoidPaymentDialog({
  payment,
  balanceAfterVoidKobo,
  onClose,
}: VoidPaymentButtonProps & { onClose: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<Mode>("VOID_ONLY");
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<PaymentDraft>({
    amount: formatNairaInput(payment.amount),
    method: payment.method,
    reference: payment.reference ?? "",
    note: payment.note ?? "",
  });
  const [errors, setErrors] = useState<PaymentFieldErrors>({});
  const [balanceKobo, setBalanceKobo] = useState(balanceAfterVoidKobo);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const { pending, run } = useOrderAction();
  const { ref, scrollToFirstError } = useScrollToFirstError();
  // Saved: the dialog stays open (Save disabled) until the refreshed page
  // arrives, so it can't be reopened with the old balance.
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (saved && !pending) onClose();
  }, [saved, pending, onClose]);
  const markSaved = () => setSaved(true);
  const replacing = mode === "REPLACE";
  const reasonHint = "Required. Staff only, never shown to the customer.";

  function change(field: PaymentField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (field === "amount") setConfirmation(null);
  }

  function handleFailure(amountKobo: number) {
    return (result: { message: string; fieldErrors?: Record<string, string>; overpayment?: { balanceKobo: number; excessKobo: number } }) => {
      if (result.overpayment) {
        setBalanceKobo(result.overpayment.balanceKobo);
        setConfirmation({ amountKobo, excessKobo: result.overpayment.excessKobo, message: result.message });
        return true;
      }
      if (result.fieldErrors) {
        setErrors(result.fieldErrors);
        scrollToFirstError();
        return true;
      }
      return false;
    };
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    const nextErrors: PaymentFieldErrors = trimmed ? {} : { reason: "Add a reason for voiding this payment" };
    const checked = replacing ? checkPaymentDraft(draft) : null;
    if (checked && !checked.ok) Object.assign(nextErrors, checked.errors);
    if (Object.keys(nextErrors).length > 0 || (checked && !checked.ok)) {
      setErrors(nextErrors);
      scrollToFirstError();
      return;
    }

    if (!checked) {
      run(() => voidPayment({ mode: "VOID_ONLY", paymentId: payment.id, reason: trimmed }), markSaved, handleFailure(0));
      return;
    }

    const confirmed = confirmation?.amountKobo === checked.amountKobo ? confirmation : null;
    const overpayment = getOverpayment(balanceKobo, checked.amountKobo);
    if (overpayment && !confirmed) {
      setConfirmation({ amountKobo: checked.amountKobo, excessKobo: overpayment.excessKobo, message: describeOverpayment(overpayment) });
      return;
    }
    run(
      () =>
        voidPayment({
          mode: "REPLACE",
          paymentId: payment.id,
          reason: trimmed,
          clientRequestId: requestId,
          confirmedExcess: confirmed?.excessKobo ?? null,
          ...draft,
        }),
      markSaved,
      handleFailure(checked.amountKobo),
    );
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && !saved && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void {describePaymentAmount({ ...payment, source: "STORE_COLLECTED" })}?</DialogTitle>
          <DialogDescription>
            For a payment recorded by mistake. It stays in the history, crossed out, and no longer counts. Payments are
            never edited or deleted.
          </DialogDescription>
        </DialogHeader>
        <form ref={ref} onSubmit={submit} className="flex flex-col gap-form" noValidate>
          <FormField id="void-reason" label="Reason" hint={reasonHint} error={errors.reason}>
            <Textarea
              id="void-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setErrors((current) => ({ ...current, reason: undefined }));
              }}
              maxLength={VOID_REASON_MAX}
              rows={2}
              required
              disabled={pending || saved}
              placeholder="For example: Entered twice"
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={describedBy("void-reason", reasonHint, errors.reason)}
              autoFocus
            />
          </FormField>

          <fieldset className="flex flex-col gap-2">
            <legend className="type-label mb-2 text-foreground">What happens next</legend>
            <RadioGroup
              value={mode}
              onValueChange={(value) => {
                setMode(value === "REPLACE" ? "REPLACE" : "VOID_ONLY");
                setConfirmation(null);
              }}
              className="gap-2"
              disabled={pending || saved}
            >
              <ModeOption id="void-only" value="VOID_ONLY" title="Void only" hint="The payment stops counting." />
              <ModeOption
                id="void-replace"
                value="REPLACE"
                title="Void and record correct payment"
                hint="Both happen together, and the new payment is linked to this one."
              />
            </RadioGroup>
          </fieldset>

          {replacing && (
            <>
              <div className="flex items-baseline justify-between gap-component rounded-md bg-muted px-3 py-2.5">
                <span className="type-body-sm text-muted-foreground">
                  {balanceKobo === null ? "No price approved yet" : "Balance due without this payment"}
                </span>
                {balanceKobo !== null && (
                  <span className="type-label text-foreground">{formatNaira(Math.max(balanceKobo, 0))}</span>
                )}
              </div>
              <PaymentFields
                idPrefix="replacement"
                draft={draft}
                errors={errors}
                amountHint="The correct amount."
                disabled={pending || saved}
                onChange={change}
              />
            </>
          )}
          {replacing && confirmation && <OverpaymentNotice message={confirmation.message} />}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending || saved}>
              Back
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || saved}>
              {pending || saved ? "Saving…" : replacing ? (confirmation ? "Void and record anyway" : "Void and record") : "Void payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ModeOption({ id, value, title, hint }: { id: string; value: Mode; title: string; hint: string }) {
  return (
    <Label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-data-checked:border-primary has-data-checked:bg-accent/40"
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="type-label text-foreground">{title}</span>
        <span className="type-caption font-normal text-muted-foreground">{hint}</span>
      </span>
    </Label>
  );
}
