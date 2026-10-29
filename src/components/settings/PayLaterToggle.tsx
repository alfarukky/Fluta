"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { setPayLater } from "@/actions/payment-settings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// "Let customers pay later" (plan 4.5). Off by default: fixed-price bookings
// then ask for payment at booking. Shown only once the store is connected.
export function PayLaterToggle({ initialValue }: { initialValue: boolean }) {
  const id = useId();
  const [enabled, setEnabled] = useState(initialValue);
  const [pending, setPending] = useState(false);

  async function toggle(next: boolean) {
    setPending(true);
    try {
      const result = await setPayLater(next);
      if (result.ok) {
        setEnabled(result.values.payLaterEnabled);
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("We couldn't save your changes. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-component rounded-lg border border-border p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={id} className="type-label text-foreground">
          Let customers pay later
        </Label>
        <p id={`${id}-hint`} className="type-caption text-muted-foreground">
          {enabled
            ? "Customers can book now and pay online or at the store later."
            : "Fixed-price bookings ask customers to pay online when they book."}
        </p>
      </div>
      <Switch
        id={id}
        checked={enabled}
        onCheckedChange={(checked) => void toggle(checked)}
        disabled={pending}
        aria-describedby={`${id}-hint`}
        className="mt-1"
      />
    </div>
  );
}
