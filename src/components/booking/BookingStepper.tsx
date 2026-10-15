import { cn } from "@/lib/utils";

interface BookingStepperProps {
  current: number; // 0-based
  total: number;
}

// "Step 2 of 5" with a bar per step. The text carries the meaning, so the
// bars are decorative.
export function BookingStepper({ current, total }: BookingStepperProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="type-caption text-muted-foreground">
        Step {current + 1} of {total}
      </p>
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full", i <= current ? "bg-primary" : "bg-muted")} />
        ))}
      </div>
    </div>
  );
}
