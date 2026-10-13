"use client";

import { CircleAlertIcon, ReceiptTextIcon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { recordDecision } from "@/actions/quotes";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { OrderStage } from "@/generated/prisma/enums";
import { formatNaira } from "@/lib/money";
import { formatDifference, getTotalDifference } from "@/lib/quotes";
import { CUSTOMER_MESSAGE_MAX, DECISION_NOTE_MAX } from "@/schemas/quotes";
import type { StageMove } from "@/types/orders";

import { CancelOrderButton } from "./OrderStageActions";
import { useOrderAction } from "./use-order-action";

interface Revision {
  id: string;
  version: number;
  total: number;
  reason: string | null;
  customerMessage: string | null;
}

type QuoteBannerProps = {
  orderId: string;
  stage: OrderStage;
  approvedTotal: number | null;
} & (
  | { kind: "pending"; revision: Revision }
  | { kind: "declined"; revision: Revision; editQuoteHref: string | null; cancelMove: StageMove | null }
);

// Shown while a revision waits for the customer, or after they declined it.
export function QuoteBanner(props: QuoteBannerProps) {
  const { revision, approvedTotal } = props;

  if (props.kind === "declined") {
    return (
      <section
        aria-labelledby="quote-banner-title"
        className="flex flex-col gap-component rounded-xl border border-error/40 bg-error/10 p-card"
      >
        <div className="flex items-start gap-3">
          <CircleAlertIcon className="mt-0.5 size-5 shrink-0 text-error" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="quote-banner-title" className="type-label break-words text-foreground">
              Customer declined{revision.customerMessage ? `: ${revision.customerMessage}` : ""}
            </h2>
            <p className="type-body-sm text-muted-foreground">
              Quote v{revision.version} ({formatNaira(revision.total)}) was declined. Issue a new quote or cancel the order.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.editQuoteHref && (
            <Button asChild>
              <Link href={props.editQuoteHref}>Edit quote</Link>
            </Button>
          )}
          {props.cancelMove && <CancelOrderButton orderId={props.orderId} stage={props.stage} move={props.cancelMove} />}
        </div>
      </section>
    );
  }

  const difference = getTotalDifference(approvedTotal, revision.total);
  return (
    <section aria-labelledby="quote-banner-title" className="flex flex-col gap-component rounded-xl border border-info/40 bg-info/10 p-card">
      <div className="flex items-start gap-3">
        <ReceiptTextIcon className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="quote-banner-title" className="type-label text-foreground">
            {approvedTotal === null ? "Quote awaiting customer approval" : "Revised total awaiting approval"}
          </h2>
          <p className="type-body-sm text-muted-foreground">Quote v{revision.version}. Record the customer&apos;s answer when they give it in person or by phone.</p>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-2 xs:grid-cols-3">
        <Amount label="Last approved total" value={approvedTotal === null ? "None yet" : formatNaira(approvedTotal)} />
        <Amount label="New total" value={formatNaira(revision.total)} strong />
        <Amount label="Difference" value={difference === null ? "—" : formatDifference(difference)} />
      </dl>
      {revision.reason && (
        <p className="type-body-sm break-words text-foreground">
          <span className="text-muted-foreground">Reason: </span>
          {revision.reason}
        </p>
      )}
      <DecisionButtons orderId={props.orderId} revisionId={revision.id} />
    </section>
  );
}

function Amount({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-component xs:flex-col xs:items-start xs:gap-0.5">
      <dt className="type-caption text-muted-foreground">{label}</dt>
      <dd className={strong ? "type-label text-foreground" : "type-body-sm text-foreground"}>{value}</dd>
    </div>
  );
}

function DecisionButtons({ orderId, revisionId }: { orderId: string; revisionId: string }) {
  const [dialog, setDialog] = useState<"APPROVE" | "DECLINE" | null>(null);
  const { pending, run } = useOrderAction();

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setDialog("APPROVE")} disabled={pending}>
        Record approval
      </Button>
      <Button variant="outline" onClick={() => setDialog("DECLINE")} disabled={pending}>
        Record decline
      </Button>
      {dialog && (
        <DecisionDialog
          key={dialog}
          decision={dialog}
          pending={pending}
          onOpenChange={(open) => !open && !pending && setDialog(null)}
          onConfirm={(fields) =>
            run(
              () =>
                recordDecision(
                  dialog === "APPROVE"
                    ? { decision: "APPROVE", orderId, revisionId, note: fields.note }
                    : { decision: "DECLINE", orderId, revisionId, customerMessage: fields.customerMessage, note: fields.note },
                ),
              () => setDialog(null),
            )
          }
        />
      )}
    </div>
  );
}

interface DecisionDialogProps {
  decision: "APPROVE" | "DECLINE";
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (fields: { note: string; customerMessage: string }) => void;
}

// Recording approval needs a note on how it was received. Recording a
// decline needs the customer's own reason (kept apart from the staff note).
function DecisionDialog({ decision, pending, onOpenChange, onConfirm }: DecisionDialogProps) {
  const approve = decision === "APPROVE";
  const [note, setNote] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [errors, setErrors] = useState<{ note?: string; customerMessage?: string }>({});
  const noteHint = approve
    ? 'Required. How the customer approved, for example "Approved by phone, 2:15 PM". Staff only.'
    : "Optional. How the customer told you. Staff only.";
  const messageHint = "What the customer said, in their words.";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    if (approve && !note.trim()) next.note = "Add a note on how the customer approved";
    if (!approve && !customerMessage.trim()) next.customerMessage = "Enter the customer's reason";
    setErrors(next);
    if (Object.keys(next).length === 0) onConfirm({ note: note.trim(), customerMessage: customerMessage.trim() });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{approve ? "Record approval" : "Record decline"}</DialogTitle>
          <DialogDescription>
            {approve
              ? "The customer approved this quote in person or by phone."
              : "The customer declined this quote. The order stays where it is until you issue a new quote or cancel it."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-form" noValidate>
          {!approve && (
            <FormField id="decision-message" label="Customer's reason" hint={messageHint} error={errors.customerMessage}>
              <Textarea
                id="decision-message"
                value={customerMessage}
                onChange={(event) => setCustomerMessage(event.target.value)}
                maxLength={CUSTOMER_MESSAGE_MAX}
                rows={2}
                required
                aria-invalid={errors.customerMessage ? true : undefined}
                aria-describedby={describedBy("decision-message", messageHint, errors.customerMessage)}
                autoFocus
              />
            </FormField>
          )}
          <FormField id="decision-note" label="Note" hint={noteHint} error={errors.note}>
            <Textarea
              id="decision-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={DECISION_NOTE_MAX}
              rows={2}
              required={approve}
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={describedBy("decision-note", noteHint, errors.note)}
              autoFocus={approve}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Back
            </Button>
            <Button type="submit" variant={approve ? "primary" : "destructive"} disabled={pending}>
              {pending ? "Saving…" : approve ? "Record approval" : "Record decline"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
