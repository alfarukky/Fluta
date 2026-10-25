import type { OrderStage } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { ORDER_STAGE_LABELS, PAYMENT_STATE_LABELS, type PaymentState } from "@/lib/orders";

type Tone = "neutral" | "success" | "warning" | "error" | "info";

const STAGE_TONES: Record<OrderStage, Tone> = {
  BOOKED: "neutral",
  PICKUP_SCHEDULED: "info",
  PICKED_UP: "info",
  RECEIVED_BY_STORE: "info",
  QUOTE_AWAITING_APPROVAL: "warning",
  IN_PROGRESS: "info",
  READY: "success",
  OUT_FOR_DELIVERY: "info",
  COMPLETED: "neutral",
  CANCELLED: "error",
};

const PAYMENT_TONES: Record<PaymentState, Tone> = {
  AWAITING_QUOTE: "neutral",
  PAYMENT_REQUIRED: "warning",
  PENDING: "info",
  PAID: "success",
  OUTSTANDING: "warning",
  REFUND_OWED: "error",
  NOTHING_DUE: "neutral",
};

// Stage and payment state are always shown separately, each with its label.
export function StageBadge({ stage }: { stage: OrderStage }) {
  return (
    <Badge variant={STAGE_TONES[stage]} dot>
      {ORDER_STAGE_LABELS[stage]}
    </Badge>
  );
}

export function PaymentBadge({ state }: { state: PaymentState }) {
  return <Badge variant={PAYMENT_TONES[state]}>{PAYMENT_STATE_LABELS[state]}</Badge>;
}

// A pickup order outside the store's listed areas, so staff notice it at once.
export function OutOfAreaBadge() {
  return <Badge variant="warning">Outside our service areas</Badge>;
}
