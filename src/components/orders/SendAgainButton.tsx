"use client";

import { RotateCwIcon } from "lucide-react";

import { resendMessage } from "@/actions/messages";
import { Button } from "@/components/ui/button";

import { useOrderAction } from "./use-order-action";

// "Send again" on a message that finally failed: a new message by the same
// channel (with a fresh link for a link message).
export function SendAgainButton({ orderId, messageId, label }: { orderId: string; messageId: string; label: string }) {
  const { pending, run } = useOrderAction();
  return (
    <Button
      variant="outline"
      onClick={() => run(() => resendMessage({ orderId, messageId }))}
      disabled={pending}
      aria-label={`Send again: ${label}`}
    >
      <RotateCwIcon data-icon="inline-start" aria-hidden />
      {pending ? "Sending…" : "Send again"}
    </Button>
  );
}
