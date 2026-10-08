"use client";

import { useState } from "react";

import { TimeSelect } from "@/components/fulfilment/TimeSelect";
import { DatePicker } from "@/components/shared/DatePicker";
import { Label } from "@/components/ui/label";

interface PickerDemoProps {
  dateLabel: string;
  timeLabel: string;
  // "YYYY-MM-DD": earlier days can't be chosen.
  today: string;
}

// Sample text arrives as props from the server page, so none of it is bundled
// into client JavaScript (the showcase is development-only).
export function PickerDemo({ dateLabel, timeLabel, today }: PickerDemoProps) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ds-date">{dateLabel}</Label>
        <DatePicker id="ds-date" value={date} onChange={setDate} min={today} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ds-time">{timeLabel}</Label>
        <TimeSelect id="ds-time" value={time} onChange={setTime} />
      </div>
    </>
  );
}
