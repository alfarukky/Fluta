"use client";

import { useEffect, useState, type FormEvent } from "react";

import { recordRefund } from "@/actions/refunds";
import { useScrollToFirstError } from "@/components/forms/scroll-to-first-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatNaira, formatNairaInput } from "@/lib/money";
import { describeRefundTooLarge } from "@/lib/refunds";
import { refundDetailsSchema } from "@/schemas/refunds";

import { checkPaymentDraft, OverpaymentNotice, PaymentFields, type PaymentDraft, type PaymentField, type PaymentFieldErrors } from "./PaymentFields";
import { useOrderAction } from "./use-order-action";

interface RecordRefundButtonProps {
  orderId: string;
  // What is owed to the customer now (above 0: the button only shows then).
  owedKobo: number;
  // The main action on the page whenever the order shows Refund owed.
  primary: boolean;
}

export function RecordRefundButton({ orderId, owedKobo, primary }: RecordRefundButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={primary ? "primary" : "outline"} onClick={() => setOpen(true)}>
        Record refund
      </Button>
      {/* Mounted only while open, so each opening starts fresh with a new request ID. */}
      {open && <RecordRefundDialog orderId={orderId} owedKobo={owedKobo} onClose={() => setOpen(false)} />}
    </>
  );
}

export const REFUND_NOTE_HINT = "Required. Staff only, never shown to the customer.";
export const REFUND_NOTE_PLACEHOLDER = "For example: Order cancelled, refunded by transfer";

function RecordRefundDialog({ orderId, owedKobo: initialOwed, onClose }: { orderId: string; owedKobo: number; onClose: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<PaymentDraft>({
    amount: formatNairaInput(initialOwed),
    method: "",
    reference: "",
    note: "",
  });
  const [errors, setErrors] = useState<PaymentFieldErrors>({});
  // What the server last said is owed: it changes if someone else records a
  // refund while this form is open.
  const [owedKobo, setOwedKobo] = useState(initialOwed);
  const [changed, setChanged] = useState<string | null>(null);
  const { pending, run } = useOrderAction();
  const { ref, scrollToFirstError } = useScrollToFirstError();
  // Saved: the dialog stays open (Save disabled) until the refreshed page
  // arrives, so it can't be reopened with the old amount owed.
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (saved && !pending) onClose();
  }, [saved, pending, onClose]);

  function change(field: PaymentField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = checkPaymentDraft(draft, refundDetailsSchema);
    if (!checked.ok) {
      setErrors(checked.errors);
      scrollToFirstError();
      return;
    }
    if (checked.amountKobo > owedKobo) {
      setErrors({ amount: describeRefundTooLarge(owedKobo) });
      scrollToFirstError();
      return;
    }

    setChanged(null);
    run(
      () => recordRefund({ orderId, clientRequestId: requestId, ...draft }),
      () => setSaved(true),
      (result) => {
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
      },
    );
  }

  const busy = pending || saved;
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record refund</DialogTitle>
          <DialogDescription>
            Money the store has already paid back to the customer, by cash, transfer, or POS. Fluta doesn&apos;t send it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-baseline justify-between gap-component rounded-md bg-muted px-3 py-2.5">
          <span className="type-body-sm text-muted-foreground">Refund owed</span>
          <span className="type-label text-foreground">{formatNaira(owedKobo)}</span>
        </div>
        <form ref={ref} onSubmit={submit} className="flex flex-col gap-form" noValidate>
          <PaymentFields
            idPrefix="record-refund"
            draft={draft}
            errors={errors}
            amountHint="Change it for a part refund."
            methodLabel="How it was paid back"
            noteHint={REFUND_NOTE_HINT}
            notePlaceholder={REFUND_NOTE_PLACEHOLDER}
            disabled={busy}
            onChange={change}
          />
          {changed && <OverpaymentNotice message={changed} />}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Back
            </Button>
            <Button type="submit" disabled={busy || owedKobo === 0}>
              {busy ? "Saving…" : "Save refund"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
