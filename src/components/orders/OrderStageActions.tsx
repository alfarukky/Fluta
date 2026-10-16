"use client";

import { MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { changeOrderStage } from "@/actions/order-stages";
import { editAddress } from "@/actions/quotes";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { FulfilmentType, OrderStage } from "@/generated/prisma/enums";
import { ORDER_STAGE_LABELS } from "@/lib/orders";
import { ADDRESS_MAX, STAGE_NOTE_MAX } from "@/schemas/orders";
import type { AvailableTransitions, StageMove, StageMoveKind } from "@/types/orders";

import { useOrderAction } from "./use-order-action";

export interface OrderQuoteActions {
  // The edit-quote screen, when the quote can still change (up to Ready).
  editQuoteHref: string | null;
  // An unpriced order at Received by store: "Price order" is the main move.
  priceOrder: boolean;
  // The current address, when it can still be edited (pickup orders, up to Ready).
  address: string | null;
}

interface OrderStageActionsProps {
  orderId: string;
  stage: OrderStage;
  fulfilmentType: FulfilmentType;
  moves: AvailableTransitions;
  quote: OrderQuoteActions;
}

const SECONDARY_LABELS: Record<Exclude<StageMoveKind, "ADVANCE">, string> = {
  COLLECTED_INSTEAD: "Customer collected instead",
  STEP_BACK: "Step back",
  CANCEL: "Cancel order",
  REOPEN: "Reopen order",
};

// The main next move's label, by stage (the spec's fixed wording).
function getAdvanceLabel(stage: OrderStage, fulfilmentType: FulfilmentType): string {
  switch (stage) {
    case "PICKUP_SCHEDULED":
      return "Mark picked up";
    case "RECEIVED_BY_STORE":
      return "Start work";
    case "IN_PROGRESS":
      return "Mark ready";
    case "READY":
      return fulfilmentType === "PICKUP_DELIVERY" ? "Out for delivery" : "Mark collected";
    case "OUT_FOR_DELIVERY":
      return "Mark delivered";
    default:
      return "Mark received";
  }
}

// Only the moves the server allows for this order are shown: one primary
// button for the main next move, the rest in a quiet menu. Moves that need a
// note (and cancelling, which is final) open a dialog first.
export function OrderStageActions({ orderId, stage, fulfilmentType, moves, quote }: OrderStageActionsProps) {
  const [dialogMove, setDialogMove] = useState<StageMove | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const { pending, run } = useOrderAction();
  const { primary, secondary, blockedReason } = moves;

  const showPriceOrder = !primary && quote.priceOrder && quote.editQuoteHref !== null;
  const showEditQuote = quote.editQuoteHref !== null && !showPriceOrder;
  const hasMenu = secondary.length > 0 || showEditQuote || quote.address !== null;
  const reason = !primary && !showPriceOrder ? blockedReason : null;

  if (!primary && !showPriceOrder && !hasMenu && !reason) return null;

  function move(stageMove: StageMove, note: string | null, onDone?: () => void) {
    run(
      () =>
        changeOrderStage({
          orderId,
          from: stage,
          to: stageMove.to,
          collectedByCustomer: stageMove.collectedByCustomer,
          note,
        }),
      onDone,
    );
  }

  function choose(stageMove: StageMove) {
    if (stageMove.noteRequired || stageMove.kind === "CANCEL") setDialogMove(stageMove);
    else move(stageMove, null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {primary && (
          <Button onClick={() => choose(primary)} disabled={pending}>
            {getAdvanceLabel(stage, fulfilmentType)}
          </Button>
        )}
        {showPriceOrder && quote.editQuoteHref && (
          <Button asChild>
            <Link href={quote.editQuoteHref}>Price order</Link>
          </Button>
        )}
        {hasMenu && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={pending}>
                <MoreHorizontalIcon data-icon="inline-start" aria-hidden />
                {primary || showPriceOrder ? "More" : "Actions"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {showEditQuote && quote.editQuoteHref && (
                <DropdownMenuItem asChild className="h-10">
                  <Link href={quote.editQuoteHref}>Edit quote</Link>
                </DropdownMenuItem>
              )}
              {quote.address !== null && (
                <DropdownMenuItem className="h-10" onSelect={() => setEditingAddress(true)}>
                  Edit address
                </DropdownMenuItem>
              )}
              {secondary.map((stageMove) => (
                <DropdownMenuItem
                  key={stageMove.kind}
                  className="h-10"
                  variant={stageMove.kind === "CANCEL" ? "destructive" : "default"}
                  onSelect={() => choose(stageMove)}
                >
                  {SECONDARY_LABELS[stageMove.kind as Exclude<StageMoveKind, "ADVANCE">]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {reason && <p className="type-body-sm text-muted-foreground">{reason}</p>}

      {dialogMove && (
        <StageNoteDialog
          // A fresh dialog for each move, so no note carries over.
          key={`${dialogMove.kind}-${stage}`}
          move={dialogMove}
          // Only a pickup order steps back from Pickup scheduled to Booked.
          resetsPickupTime={stage === "PICKUP_SCHEDULED" && dialogMove.to === "BOOKED"}
          pending={pending}
          onOpenChange={(open) => !open && !pending && setDialogMove(null)}
          onConfirm={(note) => move(dialogMove, note, () => setDialogMove(null))}
        />
      )}
      {editingAddress && quote.address !== null && (
        <AddressDialog
          address={quote.address}
          pending={pending}
          onOpenChange={(open) => !open && !pending && setEditingAddress(false)}
          onConfirm={(address) => run(() => editAddress({ orderId, address }), () => setEditingAddress(false))}
        />
      )}
    </div>
  );
}

// Cancelling from elsewhere on the page (the declined-quote banner), with the
// same confirmation and note rules as the actions menu.
export function CancelOrderButton({ orderId, stage, move }: { orderId: string; stage: OrderStage; move: StageMove }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useOrderAction();
  return (
    <>
      <Button variant="subtle-destructive" onClick={() => setOpen(true)} disabled={pending}>
        Cancel order
      </Button>
      {open && (
        <StageNoteDialog
          move={move}
          pending={pending}
          onOpenChange={(next) => !next && !pending && setOpen(false)}
          onConfirm={(note) =>
            run(
              () => changeOrderStage({ orderId, from: stage, to: move.to, collectedByCustomer: false, note }),
              () => setOpen(false),
            )
          }
        />
      )}
    </>
  );
}

interface StageNoteDialogProps {
  move: StageMove;
  // Stepping a pickup order back to Booked returns its time to the customer's request.
  resetsPickupTime?: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string | null) => void;
}

function getDialogText(
  move: StageMove,
  resetsPickupTime: boolean,
): { title: string; description: string; confirm: string; dismiss: string } {
  const target = ORDER_STAGE_LABELS[move.to];
  switch (move.kind) {
    case "COLLECTED_INSTEAD":
      return {
        title: "Customer collected instead",
        description: "The customer collected this order in person, so it won't go out for delivery. It will be marked Completed.",
        confirm: "Mark completed",
        dismiss: "Back",
      };
    case "STEP_BACK":
      return {
        title: `Step back to ${target}`,
        description: resetsPickupTime
          ? "Use this to fix a mistake. The pickup time goes back to the customer's request, so you can confirm it or suggest another. The timeline keeps both changes."
          : "Use this to fix a mistake. The order moves back one stage, and the timeline keeps both changes.",
        confirm: "Step back",
        dismiss: "Back",
      };
    case "REOPEN":
      return {
        title: "Reopen this order?",
        description: `The order goes back to ${target}. Completing it again records a new completion time.`,
        confirm: "Reopen order",
        dismiss: "Back",
      };
    default:
      return {
        title: "Cancel this order?",
        description:
          "Cancelling is final: the order can't be moved again. Its lines, payments, and history are kept, and anything collected shows as Refund owed.",
        confirm: "Cancel order",
        dismiss: "Keep order",
      };
  }
}

function StageNoteDialog({ move, resetsPickupTime = false, pending, onOpenChange, onConfirm }: StageNoteDialogProps) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const text = getDialogText(move, resetsPickupTime);
  const id = "stage-note";
  const hint = move.noteRequired ? "Required. Staff see it in the timeline." : "Optional. Staff see it in the timeline.";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    if (move.noteRequired && !trimmed) {
      setError("Add a note to explain this change.");
      return;
    }
    setError(null);
    onConfirm(trimmed || null);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-form" noValidate>
          <FormField id={id} label="Note" hint={hint} error={error ?? undefined}>
            <Textarea
              id={id}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={STAGE_NOTE_MAX}
              rows={3}
              required={move.noteRequired}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(id, hint, error ?? undefined)}
              autoFocus
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              {text.dismiss}
            </Button>
            <Button type="submit" variant={move.kind === "CANCEL" ? "destructive" : "primary"} disabled={pending}>
              {pending ? "Saving…" : text.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface AddressDialogProps {
  address: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (address: string) => void;
}

// A pickup order's address (used for both pickup and delivery). Not a price
// change, so no revision; staff see each change in the audit log.
function AddressDialog({ address, pending, onOpenChange, onConfirm }: AddressDialogProps) {
  const [value, setValue] = useState(address);
  const [error, setError] = useState<string | null>(null);
  const id = "order-address";
  const hint = "Used for both pickup and delivery.";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter the pickup and delivery address");
      return;
    }
    setError(null);
    onConfirm(trimmed);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit address</DialogTitle>
          <DialogDescription>For example, if the customer moves before delivery. The price doesn&apos;t change.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-form" noValidate>
          <FormField id={id} label="Address" hint={hint} error={error ?? undefined}>
            <Textarea
              id={id}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={ADDRESS_MAX}
              rows={3}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(id, hint, error ?? undefined)}
              autoFocus
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Back
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save address"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
