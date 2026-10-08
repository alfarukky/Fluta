"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCalendarDate } from "@/lib/time";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  id: string;
  // "YYYY-MM-DD", or "" when not set.
  value: string;
  onChange: (value: string) => void;
  // Earliest date that can be chosen, "YYYY-MM-DD" (the store's today).
  min?: string;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}

// The calendar works on local-midnight dates built from the "YYYY-MM-DD" keys,
// so the chosen day never shifts with the browser's time zone; the keys
// themselves (like `min`, the store's today) carry the time-zone decision.
function toLocalDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function DatePicker({
  id,
  value,
  onChange,
  min,
  placeholder = "Choose a date",
  invalid,
  describedBy,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? toLocalDate(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn("w-full justify-start px-3.5 font-normal", !value && "text-muted-foreground")}
        >
          <CalendarIcon data-icon="inline-start" className="text-muted-foreground" aria-hidden />
          {value ? formatCalendarDate(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? (min ? toLocalDate(min) : undefined)}
          onSelect={(date) => {
            if (!date) return;
            onChange(toKey(date));
            setOpen(false);
          }}
          disabled={min ? { before: toLocalDate(min) } : undefined}
          weekStartsOn={1}
        />
      </PopoverContent>
    </Popover>
  );
}
