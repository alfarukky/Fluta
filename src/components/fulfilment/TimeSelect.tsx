"use client";

import { ClockIcon } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClockTime, TIME_STEP_MINUTES } from "@/lib/pickup-schedule";

// Every time of day on the 15-minute step, "00:00" … "23:45".
const TIMES = Array.from({ length: (24 * 60) / TIME_STEP_MINUTES }, (_, index) =>
  formatClockTime(index * TIME_STEP_MINUTES),
);

interface TimeSelectProps {
  id: string;
  // "HH:MM", or "" when not set.
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
}

// A 24-hour time on the 15-minute step, so an off-step time can't be chosen.
export function TimeSelect({ id, value, onChange, invalid, describedBy }: TimeSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined} aria-describedby={describedBy}>
        <span className="flex items-center gap-2">
          <ClockIcon className="size-4 text-muted-foreground" aria-hidden />
          <SelectValue placeholder="Choose a time" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {TIMES.map((time) => (
          <SelectItem key={time} value={time}>
            {time}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
