"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { FulfilmentType } from "@/generated/prisma/enums";
import type { BookingOptions } from "@/types/booking";

interface FulfilmentStepProps {
  options: Pick<BookingOptions, "dropOff" | "pickup">;
  value: FulfilmentType | null;
  error?: string;
  onChange: (value: FulfilmentType) => void;
}

const CHOICES: { value: FulfilmentType; label: string; hint: string }[] = [
  { value: "DROP_OFF", label: "I'll drop it off", hint: "Bring your laundry to the store, and collect it when it's ready." },
  { value: "PICKUP_DELIVERY", label: "Pick up and deliver", hint: "The store collects your laundry and brings it back to you." },
];

// Only the ways the store offers right now.
export function FulfilmentStep({ options, value, error, onChange }: FulfilmentStepProps) {
  const offered = CHOICES.filter((choice) => (choice.value === "DROP_OFF" ? options.dropOff : options.pickup));
  return (
    <fieldset className="flex flex-col gap-2" data-form-field>
      <legend className="sr-only">How you&apos;ll get your laundry to the store</legend>
      <RadioGroup
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "fulfilment-error" : undefined}
        value={value ?? ""}
        onValueChange={(next) => {
          const choice = offered.find((candidate) => candidate.value === next);
          if (choice) onChange(choice.value);
        }}
        className="flex flex-col gap-3"
      >
        {offered.map((choice) => (
          <Label
            key={choice.value}
            htmlFor={`fulfilment-${choice.value}`}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-card has-data-checked:border-primary has-data-checked:bg-accent/40"
          >
            <RadioGroupItem id={`fulfilment-${choice.value}`} value={choice.value} className="mt-1" />
            <span className="flex flex-col gap-1">
              <span className="type-label text-card-foreground">{choice.label}</span>
              <span className="type-body-sm font-normal text-muted-foreground">{choice.hint}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      {error && (
        <p id="fulfilment-error" className="type-caption text-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
