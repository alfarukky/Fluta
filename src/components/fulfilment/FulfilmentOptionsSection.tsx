"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { setFulfilmentOption, type OptionActionResult } from "@/actions/fulfilment";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FULFILMENT_OPTION_LABELS, FULFILMENT_OPTIONS, type FulfilmentOption } from "@/schemas/fulfilment";

export type FulfilmentOptionValues = Record<FulfilmentOption, boolean>;

const OPTION_HINTS: Record<FulfilmentOption, string> = {
  dropOffEnabled: "Customers bring laundry to the store and collect it when it's ready.",
  pickupDeliveryEnabled: "You pick up from the customer's address and deliver it back, in the areas below.",
};

interface FulfilmentOptionsSectionProps {
  options: FulfilmentOptionValues;
  // Whether customers can book a pickup (isPickupAvailable).
  pickupAvailable: boolean;
  // What's missing before pickup can be booked, shown in the warning.
  pickupMissing: string[];
  onSaved: (result: Extract<OptionActionResult, { ok: true }>) => void;
  onOptionsChange: (options: FulfilmentOptionValues) => void;
}

export function FulfilmentOptionsSection({
  options,
  pickupAvailable,
  pickupMissing,
  onSaved,
  onOptionsChange,
}: FulfilmentOptionsSectionProps) {
  const id = useId();
  const [pending, setPending] = useState<FulfilmentOption | null>(null);

  async function toggle(option: FulfilmentOption, enabled: boolean) {
    setPending(option);
    try {
      const result = await setFulfilmentOption(option, enabled);
      if (result.ok) {
        onSaved(result);
        toast.success(result.message, {
          description: enabled ? undefined : "Existing orders keep their fulfilment type.",
        });
      } else {
        if (result.options) onOptionsChange(result.options);
        toast.error(result.message);
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <Card role="region" aria-labelledby={`${id}-title`}>
      <CardHeader>
        <CardTitle id={`${id}-title`} className="type-h3">
          Fulfilment options
        </CardTitle>
        <CardDescription className="type-body-sm">
          How customers get their laundry to you and back. Keep at least one on; changes apply to new orders only.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-component">
        {FULFILMENT_OPTIONS.map((option) => (
          <div key={option} className="flex items-start justify-between gap-component rounded-lg border border-border p-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor={`${id}-${option}`} className="type-label text-foreground">
                {FULFILMENT_OPTION_LABELS[option]}
              </Label>
              <p id={`${id}-${option}-hint`} className="type-caption text-muted-foreground">
                {OPTION_HINTS[option]}
              </p>
            </div>
            <Switch
              id={`${id}-${option}`}
              checked={options[option]}
              onCheckedChange={(checked) => void toggle(option, checked)}
              disabled={pending !== null}
              aria-describedby={`${id}-${option}-hint`}
              className="mt-1"
            />
          </div>
        ))}

        {options.pickupDeliveryEnabled && !pickupAvailable && (
          <div role="status" className="flex gap-3 rounded-xl border border-warning/30 bg-warning/8 p-4">
            <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="type-label text-foreground">Customers can&apos;t book pickup yet</p>
              <p className="type-body-sm text-muted-foreground">
                {pickupMissing.length > 0
                  ? `To take pickup bookings: ${pickupMissing.join("; ")}.`
                  : "Check your service areas and pickup schedule."}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
