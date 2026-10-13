"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { changeOrderStage } from "@/actions/order-stages";
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
import { STAGE_NOTE_MAX } from "@/schemas/orders";
import type { AvailableTransitions, StageMove, StageMoveKind } from "@/types/orders";

interface OrderStageActionsProps {
  orderId: string;
  stage: OrderStage;
  fulfilmentType: FulfilmentType;
  moves: AvailableTransitions;
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
export function OrderStageActions({ orderId, stage, fulfilmentType, moves }: OrderStageActionsProps) {
  const [dialogMove, setDialogMove] = useState<StageMove | null>(null);
  const [pending, startTransition] = useTransition();
  // The success message waits until the transition ends, when the page shows
  // the new stage (the action's result arrives before the refreshed page).
  const successMessage = useRef<string | null>(null);
  const { primary, secondary, blockedReason } = moves;

  useEffect(() => {
    if (pending || !successMessage.current) return;
    toast.success(successMessage.current);
    successMessage.current = null;
  }, [pending]);

  if (!primary && secondary.length === 0 && !blockedReason) return null;

  function run(move: StageMove, note: string | null, onDone?: () => void) {
    startTransition(async () => {
      const result = await changeOrderStage({
        orderId,
        from: stage,
        to: move.to,
        collectedByCustomer: move.collectedByCustomer,
        note,
      });
      if (result.ok) {
        successMessage.current = result.message;
        onDone?.();
      } else {
        toast.error(result.message);
      }
    });
  }

  function choose(move: StageMove) {
    if (move.noteRequired || move.kind === "CANCEL") setDialogMove(move);
    else run(move, null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {primary && (
          <Button onClick={() => choose(primary)} disabled={pending}>
            {getAdvanceLabel(stage, fulfilmentType)}
          </Button>
        )}
        {secondary.length > 0 && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={pending}>
                <MoreHorizontalIcon data-icon="inline-start" aria-hidden />
                {primary ? "More" : "Actions"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {secondary.map((move) => (
                <DropdownMenuItem
                  key={move.kind}
                  className="h-10"
                  variant={move.kind === "CANCEL" ? "destructive" : "default"}
                  onSelect={() => choose(move)}
                >
                  {SECONDARY_LABELS[move.kind as Exclude<StageMoveKind, "ADVANCE">]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {!primary && blockedReason && <p className="type-body-sm text-muted-foreground">{blockedReason}</p>}

      {dialogMove && (
        <StageNoteDialog
          // A fresh dialog for each move, so no note carries over.
          key={`${dialogMove.kind}-${stage}`}
          move={dialogMove}
          pending={pending}
          onOpenChange={(open) => !open && !pending && setDialogMove(null)}
          onConfirm={(note) => run(dialogMove, note, () => setDialogMove(null))}
        />
      )}
    </div>
  );
}

interface StageNoteDialogProps {
  move: StageMove;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string | null) => void;
}

function getDialogText(move: StageMove): { title: string; description: string; confirm: string; dismiss: string } {
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
        description: "Use this to fix a mistake. The order moves back one stage, and the timeline keeps both changes.",
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

function StageNoteDialog({ move, pending, onOpenChange, onConfirm }: StageNoteDialogProps) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const text = getDialogText(move);
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
