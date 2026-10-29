"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_QUANTITY, MIN_QUANTITY, parseQuantity } from "@/lib/quantity";
import { cn } from "@/lib/utils";

// − [ 2 ] + for whole quantities (items, packages). The number can also be
// typed: the value stays as typed text, so the form's own check reports
// anything that isn't a whole number in range.

// The value after − or +, kept within min–max. From an empty or unreadable
// box, either button starts at min.
export function stepQuantity(text: string, delta: -1 | 1, min = MIN_QUANTITY, max = MAX_QUANTITY): string {
  const current = parseQuantity(text);
  if (current === null) return String(min);
  return String(Math.min(max, Math.max(min, current + delta)));
}

interface QuantityStepperProps
  extends Omit<ComponentProps<"input">, "value" | "onChange" | "type" | "min" | "max" | "size"> {
  id: string;
  value: string;
  onChange: (value: string) => void;
  // What the buttons change, for screen readers: "Decrease {label}".
  label: string;
  min?: number;
  max?: number;
}

// − is disabled at min (taking an item off is the caller's Remove), + at max.
export function QuantityStepper({
  id,
  value,
  onChange,
  label,
  min = MIN_QUANTITY,
  max = MAX_QUANTITY,
  className,
  disabled,
  ...inputProps
}: QuantityStepperProps) {
  const current = parseQuantity(value);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onChange(stepQuantity(value, -1, min, max))}
        disabled={disabled || (current !== null && current <= min)}
        aria-label={`Decrease ${label}`}
        aria-controls={id}
      >
        <MinusIcon aria-hidden />
      </Button>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        className="w-20 text-center tabular-nums"
        {...inputProps}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onChange(stepQuantity(value, 1, min, max))}
        disabled={disabled || (current !== null && current >= max)}
        aria-label={`Increase ${label}`}
        aria-controls={id}
      >
        <PlusIcon aria-hidden />
      </Button>
    </div>
  );
}
