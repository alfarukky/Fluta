"use client";

import { useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIME_STEP_MINUTES } from "@/lib/pickup-schedule";
import { fromTwelveHour, toTwelveHour, type Meridiem, type TwelveHourTime } from "@/lib/time";

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
// 00, 15, 30, 45: the 15-minute step, so an off-step time can't be chosen.
const MINUTES = Array.from({ length: 60 / TIME_STEP_MINUTES }, (_, index) =>
  String(index * TIME_STEP_MINUTES).padStart(2, "0"),
);
const PERIODS: readonly Meridiem[] = ["AM", "PM"];

interface TimeSelectProps {
  id: string;
  // The field's visible label, used to name the minutes and AM/PM controls.
  label: string;
  // Stored 24-hour "HH:MM", or "" when not set.
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
}

type Draft = Partial<Pick<TwelveHourTime, "minute" | "period">> & { hour?: number };

// A time of day as hour (1–12), minutes and AM/PM, stored as 24-hour "HH:MM".
// Until all three are chosen the value stays "" and the choices so far are
// kept here.
export function TimeSelect({ id, label, value, onChange, invalid, describedBy }: TimeSelectProps) {
  const [draft, setDraft] = useState<Draft>({});
  const parts: Draft = toTwelveHour(value) ?? draft;

  function update(change: Draft) {
    const next = { ...parts, ...change };
    if (next.hour && next.minute && next.period) {
      setDraft({});
      onChange(fromTwelveHour({ hour: next.hour, minute: next.minute, period: next.period }));
    } else {
      setDraft(next);
      onChange("");
    }
  }

  const triggerProps = {
    className: "w-full",
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
  };

  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-2">
      <Select value={parts.hour ? String(parts.hour) : ""} onValueChange={(hour) => update({ hour: Number(hour) })}>
        {/* The field's label points here (htmlFor={id}), so clicking it opens the hour. */}
        <SelectTrigger id={id} aria-label={`${label} hour`} {...triggerProps}>
          <SelectValue placeholder="Hour" />
        </SelectTrigger>
        <SelectContent>
          {HOURS.map((hour) => (
            <SelectItem key={hour} value={hour}>
              {hour}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={parts.minute ?? ""} onValueChange={(minute) => update({ minute })}>
        <SelectTrigger aria-label={`${label} minutes`} {...triggerProps}>
          <SelectValue placeholder="Min" />
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map((minute) => (
            <SelectItem key={minute} value={minute}>
              {minute}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={parts.period ?? ""} onValueChange={(period) => update({ period: period as Meridiem })}>
        <SelectTrigger aria-label={`${label} AM or PM`} {...triggerProps}>
          <SelectValue placeholder="AM/PM" />
        </SelectTrigger>
        <SelectContent>
          {PERIODS.map((period) => (
            <SelectItem key={period} value={period}>
              {period}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
