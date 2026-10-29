"use client";

import { useEffect, useState, type FormEvent } from "react";

import { recordPayment } from "@/actions/payments";
import { useScrollToFirstError } from "@/components/forms/scroll-to-first-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatNairaInput } from "@/lib/money";
import {
  describeBalance,
  describeOverpayment,
  getOverpayment,
  getSuggestedPaymentKobo,
  type BalanceFigures,
} from "@/lib/payments";

import {
  checkPaymentDraft,
  OverpaymentNotice,
  PaymentFields,
  type PaymentDraft,
  type PaymentField,
  type PaymentFieldErrors,
} from "./PaymentFields";
import { useOrderAction } from "./use-order-action";

interface RecordPaymentButtonProps {
  orderId: string;
  balance: BalanceFigures;
  // The main action on the page (Ready or Completed with a balance due).
  primary: boolean;
  // An online payment for this order is being confirmed.
  pendingOnline: boolean;
}

export function RecordPaymentButton({ orderId, balance, primary, pendingOnline }: RecordPaymentButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={primary ? "primary" : "outline"} onClick={() => setOpen(true)}>
        Record payment
      </Button>
      {/* Mounted only while open, so each opening starts fresh with a new request ID. */}
      {open && <RecordPaymentDialog orderId={orderId} balance={balance} pendingOnline={pendingOnline} onClose={() => setOpen(false)} />}
    </>
  );
}

// An overpayment staff are being asked to confirm, for this amount.
interface PendingConfirmation {
  amountKobo: number;
  excessKobo: number;
  message: string;
}

function RecordPaymentDialog({
  orderId,
  balance,
  pendingOnline,
  onClose,
}: {
  orderId: string;
  balance: BalanceFigures;
  pendingOnline: boolean;
  onClose: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const suggested = getSuggestedPaymentKobo(balance.balanceKobo);
  const [draft, setDraft] = useState<PaymentDraft>({
    amount: suggested === null ? "" : formatNairaInput(suggested),
    method: "",
    reference: "",
    note: "",
  });
  const [errors, setErrors] = useState<PaymentFieldErrors>({});
  // The balance the server last reported: it changes if someone else records
  // a payment while this form is open.
  const [balanceKobo, setBalanceKobo] = useState(balance.balanceKobo);
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
  const shown = describeBalance({ ...balance, balanceKobo });

  function change(field: PaymentField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (field === "amount") setConfirmation(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = checkPaymentDraft(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      scrollToFirstError();
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
        recordPayment({
          orderId,
          clientRequestId: requestId,
          confirmedExcess: confirmed?.excessKobo ?? null,
          ...draft,
        }),
      markSaved,
      (result) => {
        if (result.overpayment) {
          setBalanceKobo(result.overpayment.balanceKobo);
          setConfirmation({ amountKobo: checked.amountKobo, excessKobo: result.overpayment.excessKobo, message: result.message });
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

  const awaitingPrice = balanceKobo === null;
  return (
    <Dialog open onOpenChange={(next) => !next && !pending && !saved && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Money the customer paid at the store or straight to the store.</DialogDescription>
        </DialogHeader>
        {/* Information only: it never blocks recording. */}
        {pendingOnline && (
          <p role="status" className="type-body-sm rounded-md border border-info/40 bg-info/10 px-3 py-2.5 text-foreground">
            An online payment for this order is being confirmed.
          </p>
        )}
        <div className="flex items-baseline justify-between gap-component rounded-md bg-muted px-3 py-2.5">
          <span className="type-body-sm text-muted-foreground">{shown.label}</span>
          <span className="type-label text-foreground">{shown.value}</span>
        </div>
        {awaitingPrice && (
          <p className="type-caption text-muted-foreground">No price is approved yet, so this counts as a deposit.</p>
        )}
        <form ref={ref} onSubmit={submit} className="flex flex-col gap-form" noValidate>
          <PaymentFields
            idPrefix="record-payment"
            draft={draft}
            errors={errors}
            amountHint={awaitingPrice ? undefined : "Change it for a part payment."}
            disabled={pending || saved}
            onChange={change}
          />
          {confirmation && <OverpaymentNotice message={confirmation.message} />}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending || saved}>
              Back
            </Button>
            <Button type="submit" disabled={pending || saved}>
              {pending || saved ? "Saving…" : confirmation ? "Record anyway" : "Save payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
