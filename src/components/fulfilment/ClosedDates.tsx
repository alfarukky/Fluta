"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { addClosedDate, removeClosedDate } from "@/actions/fulfilment";
import { describedBy, FormField } from "@/components/settings/FormField";
import { DatePicker } from "@/components/shared/DatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCalendarDate } from "@/lib/time";
import { CLOSED_DATE_NOTE_MAX } from "@/schemas/fulfilment";
import type { FulfilmentClosedDate } from "@/types/fulfilment";

interface ClosedDatesProps {
  // Upcoming closed dates from the server, soonest first.
  closedDates: FulfilmentClosedDate[];
  // "YYYY-MM-DD" in the store's time zone.
  today: string;
}

const byDate = (a: FulfilmentClosedDate, b: FulfilmentClosedDate) => a.date.localeCompare(b.date);

export function ClosedDates({ closedDates: listed, today }: ClosedDatesProps) {
  const id = useId();
  // Added and removed here, shown at once; the server's list catches up on refresh.
  const [added, setAdded] = useState<FulfilmentClosedDate[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [values, setValues] = useState({ date: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, startAdding] = useTransition();
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(new Set());

  const listedIds = new Set(listed.map((closed) => closed.id));
  const closedDates = [...listed, ...added.filter((closed) => !listedIds.has(closed.id))]
    .filter((closed) => !removed.has(closed.id) && closed.date >= today)
    .sort(byDate);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("date", values.date);
    formData.set("note", values.note);
    startAdding(async () => {
      const result = await addClosedDate(formData);
      if (result.ok) {
        setAdded((current) => [...current, result.closedDate]);
        setValues({ date: "", note: "" });
        setErrors({});
        toast.success(`${result.message}: ${formatCalendarDate(result.closedDate.date)}`);
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
      }
    });
  }

  async function remove(closed: FulfilmentClosedDate) {
    setRemovingIds((current) => new Set(current).add(closed.id));
    try {
      const result = await removeClosedDate(closed.id);
      if (result.ok) {
        setRemoved((current) => new Set(current).add(closed.id));
        toast.success(`${result.message}: ${formatCalendarDate(closed.date)}`);
      } else {
        toast.error(result.message);
      }
    } finally {
      setRemovingIds((current) => {
        const next = new Set(current);
        next.delete(closed.id);
        return next;
      });
    }
  }

  const fieldId = (name: string) => `${id}-${name}`;

  return (
    <section aria-labelledby={fieldId("title")} className="flex flex-col gap-component">
      <div className="flex flex-col gap-1">
        <h3 id={fieldId("title")} className="type-label text-foreground">
          Closed dates
        </h3>
        <p className="type-caption text-muted-foreground">Days with no pickups or deliveries, such as public holidays.</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-form" noValidate>
        <div className="grid gap-form md:grid-cols-[14rem_1fr]">
          <FormField id={fieldId("date")} label="Date" error={errors.date}>
            <DatePicker
              id={fieldId("date")}
              value={values.date}
              onChange={(date) => setValues((current) => ({ ...current, date }))}
              min={today}
              invalid={Boolean(errors.date)}
              describedBy={describedBy(fieldId("date"), undefined, errors.date)}
            />
          </FormField>
          <FormField id={fieldId("note")} label="Note (optional)" error={errors.note}>
            <Input
              id={fieldId("note")}
              value={values.note}
              onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))}
              maxLength={CLOSED_DATE_NOTE_MAX}
              autoComplete="off"
              aria-invalid={errors.note ? true : undefined}
              placeholder="Like Public holiday"
              aria-describedby={describedBy(fieldId("note"), undefined, errors.note)}
            />
          </FormField>
        </div>
        <Button type="submit" variant="outline" disabled={adding || !values.date} className="xs:self-end">
          {adding ? "Adding…" : "Add closed date"}
        </Button>
      </form>

      {closedDates.length === 0 ? (
        <p className="type-body-sm text-muted-foreground">No upcoming closed dates.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {closedDates.map((closed) => (
            <li key={closed.id} className="flex items-center justify-between gap-component p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-label text-foreground">{formatCalendarDate(closed.date)}</span>
                {closed.note && <span className="type-caption break-words text-muted-foreground">{closed.note}</span>}
              </div>
              <Button
                variant="subtle-destructive"
                onClick={() => void remove(closed)}
                disabled={removingIds.has(closed.id)}
                aria-label={`Remove closed date ${formatCalendarDate(closed.date)}`}
                className="shrink-0"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
