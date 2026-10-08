"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { saveSchedule, type ScheduleActionResult } from "@/actions/fulfilment";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatPickupWindow, getPickupWindows, WEEK_DAYS } from "@/lib/pickup-schedule";
import { cn } from "@/lib/utils";
import type { FulfilmentClosedDate } from "@/types/fulfilment";

import { ClosedDates } from "./ClosedDates";
import { TimeSelect } from "./TimeSelect";

export interface ScheduleValues {
  activeDays: number[];
  openTime: string | null;
  closeTime: string | null;
}

interface ScheduleSectionProps {
  schedule: ScheduleValues;
  pickupDeliveryEnabled: boolean;
  closedDates: FulfilmentClosedDate[];
  today: string;
  // "West Africa Standard Time (Africa/Lagos)"
  timeZoneLabel: string;
  onSaved: (result: Extract<ScheduleActionResult, { ok: true }>) => void;
}

interface FormValues {
  activeDays: number[];
  openTime: string;
  closeTime: string;
}

function toFormValues(schedule: ScheduleValues): FormValues {
  return { activeDays: schedule.activeDays, openTime: schedule.openTime ?? "", closeTime: schedule.closeTime ?? "" };
}

const sameDays = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort().every((day, index) => day === [...b].sort()[index]);

export function ScheduleSection({
  schedule,
  pickupDeliveryEnabled,
  closedDates,
  today,
  timeZoneLabel,
  onSaved,
}: ScheduleSectionProps) {
  const id = useId();
  const [saved, setSaved] = useState(() => toFormValues(schedule));
  const [values, setValues] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const dirty =
    !sameDays(values.activeDays, saved.activeDays) ||
    values.openTime !== saved.openTime ||
    values.closeTime !== saved.closeTime;
  const windows = values.openTime && values.closeTime ? getPickupWindows(values.openTime, values.closeTime) : [];

  function toggleDay(day: number, on: boolean) {
    setValues((current) => ({
      ...current,
      activeDays: on ? [...current.activeDays, day] : current.activeDays.filter((value) => value !== day),
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    for (const day of values.activeDays) formData.append("activeDays", String(day));
    formData.set("openTime", values.openTime);
    formData.set("closeTime", values.closeTime);

    startTransition(async () => {
      const result = await saveSchedule(formData);
      if (result.ok) {
        const next = toFormValues(result.schedule);
        setSaved(next);
        setValues(next);
        setErrors({});
        toast.success(result.message);
        onSaved(result);
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
      }
    });
  }

  const fieldId = (name: string) => `${id}-${name}`;

  return (
    <Card role="region" aria-labelledby={fieldId("title")}>
      <CardHeader>
        <CardTitle id={fieldId("title")} className="type-h3">
          Pickup & delivery schedule
        </CardTitle>
        <CardDescription className="type-body-sm">
          The days and hours you pick up and deliver. Drop-off isn&apos;t affected.
          {!pickupDeliveryEnabled && " Used when Pickup & delivery is on."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-section">
        <form onSubmit={submit} className="flex flex-col gap-form" noValidate>
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={errors.activeDays ? fieldId("days-error") : undefined}
          >
            <legend className="type-label mb-2 text-foreground">Active days</legend>
            <div className="grid grid-cols-4 gap-2 xs:grid-cols-7">
              {WEEK_DAYS.map((day) => {
                const checked = values.activeDays.includes(day.value);
                return (
                  <label
                    key={day.value}
                    className={cn(
                      "type-label flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 transition-colors select-none",
                      "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={(event) => toggleDay(day.value, event.target.checked)}
                      aria-label={day.long}
                    />
                    <span aria-hidden>{day.short}</span>
                  </label>
                );
              })}
            </div>
            {errors.activeDays && (
              <p id={fieldId("days-error")} className="type-caption text-error">
                {errors.activeDays}
              </p>
            )}
          </fieldset>

          <div className="grid gap-form md:grid-cols-2">
            <FormField id={fieldId("open")} label="Opening time" error={errors.openTime}>
              <TimeSelect
                id={fieldId("open")}
                label="Opening time"
                value={values.openTime}
                onChange={(openTime) => setValues((current) => ({ ...current, openTime }))}
                invalid={Boolean(errors.openTime)}
                describedBy={describedBy(fieldId("open"), undefined, errors.openTime)}
              />
            </FormField>
            <FormField id={fieldId("close")} label="Closing time" error={errors.closeTime}>
              <TimeSelect
                id={fieldId("close")}
                label="Closing time"
                value={values.closeTime}
                onChange={(closeTime) => setValues((current) => ({ ...current, closeTime }))}
                invalid={Boolean(errors.closeTime)}
                describedBy={describedBy(fieldId("close"), undefined, errors.closeTime)}
              />
            </FormField>
          </div>

          <div className="flex flex-col gap-1">
            <p className="type-caption text-muted-foreground">Times are in {timeZoneLabel}.</p>
            <p className="type-body-sm text-muted-foreground" aria-live="polite">
              {windows.length > 0 ? (
                <>
                  Customers will see:{" "}
                  <span className="font-medium text-foreground">{windows.map(formatPickupWindow).join(", ")}</span>
                </>
              ) : (
                "Choose opening and closing times to see the 2-hour pickup windows customers choose from."
              )}
            </p>
          </div>

          <div className="flex flex-col-reverse gap-component xs:flex-row xs:justify-end">
            <Button type="button" variant="ghost" onClick={() => setValues(saved)} disabled={!dirty || pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!dirty || pending}>
              {pending ? "Saving…" : "Save schedule"}
            </Button>
          </div>
        </form>

        <Separator />

        <ClosedDates closedDates={closedDates} today={today} />
      </CardContent>
    </Card>
  );
}
