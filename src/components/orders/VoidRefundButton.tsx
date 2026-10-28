"use client";

import { useEffect, useState, type FormEvent } from "react";

import { voidRefund } from "@/actions/refunds";
import { useScrollToFirstError } from "@/components/forms/scroll-to-first-error";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { formatNaira, formatNairaInput } from "@/lib/money";
import { describeRefundAmount, describeRefundTooLarge, type RefundMethod } from "@/lib/refunds";
import { REFUND_VOID_REASON_MAX, refundDetailsSchema } from "@/schemas/refunds";

import { checkPaymentDraft, OverpaymentNotice, PaymentFields, type PaymentDraft, type PaymentField, type PaymentFieldErrors } from "./PaymentFields";
import { REFUND_NOTE_HINT } from "./RecordRefundButton";
import { useOrderAction } from "./use-order-action";

export interface VoidableRefund {
  id: string;
  amount: number;
  method: RefundMethod;
  reference: string | null;
  note: string;
}

interface VoidRefundButtonProps {
  refund: VoidableRefund;
  // What is owed to the customer once this refund no longer counts.
  owedAfterVoidKobo: number;
}

// Owners only (the server checks again).
export function VoidRefundButton({ refund, owedAfterVoidKobo }: VoidRefundButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="subtle-destructive"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Void refund of ${describeRefundAmount(refund)}`}
        className="h-11 md:h-9"
      >
        Void
      </Button>
      {open && <VoidRefundDialog refund={refund} owedAfterVoidKobo={owedAfterVoidKobo} onClose={() => setOpen(false)} />}
    </>
  );
}

type Mode = "VOID_ONLY" | "REPLACE";

function VoidRefundDialog({ refund, owedAfterVoidKobo, onClose }: VoidRefundButtonProps & { onClose: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<Mode>("VOID_ONLY");
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<PaymentDraft>({
    amount: formatNairaInput(refund.amount),
    method: refund.method,
    reference: refund.reference ?? "",
    note: refund.note,
  });
  const [errors, setErrors] = useState<PaymentFieldErrors>({});
  const [owedKobo, setOwedKobo] = useState(owedAfterVoidKobo);
  const [changed, setChanged] = useState<string | null>(null);
  const { pending, run } = useOrderAction();
  const { ref, scrollToFirstError } = useScrollToFirstError();
  // Saved: the dialog stays open (Save disabled) until the refreshed page arrives.
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (saved && !pending) onClose();
  }, [saved, pending, onClose]);
  const replacing = mode === "REPLACE";
  const busy = pending || saved;
  const reasonHint = "Required. Staff only, never shown to the customer.";

  function change(field: PaymentField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function handleFailure(result: { message: string; fieldErrors?: Record<string, string>; owedKobo?: number }) {
    if (result.owedKobo !== undefined) {
      setOwedKobo(result.owedKobo);
      setChanged(result.message);
      return true;
    }
    if (result.fieldErrors) {
      setErrors(result.fieldErrors);
      scrollToFirstError();
      return true;
    }
    return false;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    const nextErrors: PaymentFieldErrors = trimmed ? {} : { reason: "Add a reason for voiding this refund" };
    const checked = replacing ? checkPaymentDraft(draft, refundDetailsSchema) : null;
    if (checked && !checked.ok) Object.assign(nextErrors, checked.errors);
    if (checked?.ok && checked.amountKobo > owedKobo) nextErrors.amount = describeRefundTooLarge(owedKobo);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      scrollToFirstError();
      return;
    }

    setChanged(null);
    if (!replacing) {
      run(() => voidRefund({ mode: "VOID_ONLY", refundId: refund.id, reason: trimmed }), () => setSaved(true), handleFailure);
      return;
    }
    run(
      () => voidRefund({ mode: "REPLACE", refundId: refund.id, reason: trimmed, clientRequestId: requestId, ...draft }),
      () => setSaved(true),
      handleFailure,
    );
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void refund of {describeRefundAmount(refund)}?</DialogTitle>
          <DialogDescription>
            For a refund recorded by mistake. It stays in the history, crossed out, and no longer counts. Refunds are
            never edited or deleted.
          </DialogDescription>
        </DialogHeader>
        <form ref={ref} onSubmit={submit} className="flex flex-col gap-form" noValidate>
          <FormField id="void-refund-reason" label="Reason" hint={reasonHint} error={errors.reason}>
            <Textarea
              id="void-refund-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setErrors((current) => ({ ...current, reason: undefined }));
              }}
              maxLength={REFUND_VOID_REASON_MAX}
              rows={2}
              required
              disabled={busy}
              placeholder="For example: Wrong amount entered"
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={describedBy("void-refund-reason", reasonHint, errors.reason)}
              autoFocus
            />
          </FormField>

          <fieldset className="flex flex-col gap-2">
            <legend className="type-label mb-2 text-foreground">What happens next</legend>
            <RadioGroup
              value={mode}
              onValueChange={(value) => {
                setMode(value === "REPLACE" ? "REPLACE" : "VOID_ONLY");
                setChanged(null);
              }}
              className="gap-2"
              disabled={busy}
            >
              <ModeOption id="void-refund-only" value="VOID_ONLY" title="Void only" hint="The refund stops counting." />
              <ModeOption
                id="void-refund-replace"
                value="REPLACE"
                title="Void and record correct refund"
                hint="Both happen together, and the new refund is linked to this one."
              />
            </RadioGroup>
          </fieldset>

          {replacing && (
            <>
              <div className="flex items-baseline justify-between gap-component rounded-md bg-muted px-3 py-2.5">
                <span className="type-body-sm text-muted-foreground">Refund owed without this refund</span>
                <span className="type-label text-foreground">{formatNaira(owedKobo)}</span>
              </div>
              <PaymentFields
                idPrefix="replacement-refund"
                draft={draft}
                errors={errors}
                amountHint="The correct amount."
                methodLabel="How it was paid back"
                noteHint={REFUND_NOTE_HINT}
                disabled={busy}
                onChange={change}
              />
            </>
          )}
          {changed && <OverpaymentNotice message={changed} />}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Back
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? "Saving…" : replacing ? "Void and record" : "Void refund"}
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
