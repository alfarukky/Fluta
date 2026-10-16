"use client";

import { CalendarClockIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { confirmPickupTime, suggestPickupTime } from "@/actions/pickup-times";
import { TimeSelect } from "@/components/fulfilment/TimeSelect";
import { describedBy, FormField } from "@/components/settings/FormField";
import { DatePicker } from "@/components/shared/DatePicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatPickupWindow, getPickupWindows, type PickupSchedule } from "@/lib/pickup-schedule";
import { fromDateKey } from "@/lib/time";
import { SUGGESTION_NOTE_MAX } from "@/schemas/pickup-times";

import { useOrderAction } from "./use-order-action";

export interface PickupTimeOptions {
  schedule: PickupSchedule;
  // Closed dates from today, "YYYY-MM-DD".
  closedDates: string[];
  today: string;
}

interface PickupTimeCardProps {
  orderId: string;
  status: "REQUESTED" | "PROPOSED_BY_STORE";
  // "Tue, 20 Oct 2026 · 10:00 AM–12:00 PM"
  requested: string;
  suggested: string | null;
  canConfirm: boolean;
  canSuggest: boolean;
  blockedReason: string | null;
  // Loaded only when a suggestion can be made.
  options: PickupTimeOptions | null;
}

// A pickup order waiting for its time to be confirmed: confirm the time the
// customer asked for, or suggest another (the customer accepts it on their
// tracking page). Replacing a suggestion is allowed until they answer.
export function PickupTimeCard({
  orderId,
  status,
  requested,
  suggested,
  canConfirm,
  canSuggest,
  blockedReason,
  options,
}: PickupTimeCardProps) {
  const [suggesting, setSuggesting] = useState(false);
  const { pending, run } = useOrderAction();
  const proposed = status === "PROPOSED_BY_STORE";

  return (
    <section aria-labelledby="pickup-time-title" className="flex flex-col gap-component rounded-xl border border-warning/40 bg-warning/10 p-card">
      <div className="flex items-start gap-3">
        <CalendarClockIcon className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="pickup-time-title" className="type-label text-foreground">
            {proposed ? "Waiting for the customer to accept the suggested time" : "Pickup time to confirm"}
          </h2>
          {proposed && suggested && <p className="type-body-sm text-foreground">Suggested: {suggested}</p>}
          <p className="type-body-sm text-muted-foreground">Customer asked for: {requested}</p>
          {blockedReason && <p className="type-body-sm text-muted-foreground">{blockedReason}</p>}
        </div>
      </div>
      {(canConfirm || canSuggest) && (
        <div className="flex flex-wrap gap-2">
          {canConfirm && (
            <Button onClick={() => run(() => confirmPickupTime({ orderId }))} disabled={pending}>
              Confirm requested time
            </Button>
          )}
          {canSuggest && options && (
            <Button variant={canConfirm ? "outline" : "primary"} onClick={() => setSuggesting(true)} disabled={pending}>
              {proposed ? "Suggest a different time" : "Suggest another time"}
            </Button>
          )}
        </div>
      )}
      {suggesting && options && (
        <SuggestTimeDialog
          options={options}
          pending={pending}
          onOpenChange={(open) => !open && !pending && setSuggesting(false)}
          onSubmit={(request, onFieldError) =>
            run(async () => {
              const result = await suggestPickupTime({ orderId, ...request });
              if (!result.ok) onFieldError(result);
              return result;
            }, () => setSuggesting(false))
          }
        />
      )}
    </section>
  );
}

interface SuggestionRequest {
  date: string;
  outsideSchedule: boolean;
  windowStart: string;
  windowEnd: string;
  note: string | null;
}

const NOTE_HINT = "Required: explain the pickup outside the normal schedule. Staff see it in the timeline, never customers.";

type FieldErrors = Partial<Record<"date" | "window" | "note", string>>;

interface SuggestTimeDialogProps {
  options: PickupTimeOptions;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: SuggestionRequest, onFieldError: (result: { message: string; field?: string; fieldErrors?: Record<string, string> }) => void) => void;
}

function SuggestTimeDialog({ options, pending, onOpenChange, onSubmit }: SuggestTimeDialogProps) {
  const id = useId();
  const fieldId = (name: string) => `${id}-${name}`;
  const { schedule, closedDates, today } = options;
  const [outsideSchedule, setOutsideSchedule] = useState(false);
  const [date, setDate] = useState("");
  const [windowKey, setWindowKey] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const windows = schedule.openTime && schedule.closeTime ? getPickupWindows(schedule.openTime, schedule.closeTime) : [];
  const closed = new Set(closedDates);
  const isDateDisabled = (key: string) =>
    !outsideSchedule && (closed.has(key) || !schedule.activeDays.includes(fromDateKey(key).getUTCDay()));

  function showServerError(result: { message: string; field?: string; fieldErrors?: Record<string, string> }) {
    const fieldErrors = result.fieldErrors ?? {};
    const found: FieldErrors = {
      date: fieldErrors.date ?? (result.field === "date" ? result.message : undefined),
      window: fieldErrors.windowStart ?? fieldErrors.windowEnd ?? (result.field === "window" ? result.message : undefined),
      note: fieldErrors.note,
    };
    if (found.date || found.window || found.note) setErrors(found);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const [windowStart = "", windowEnd = ""] = outsideSchedule ? [customStart, customEnd] : windowKey.split("-");
    const trimmed = note.trim();
    const found: FieldErrors = {};
    if (!date) found.date = "Choose a pickup date";
    if (!windowStart || !windowEnd) found.window = outsideSchedule ? "Choose a start and end time" : "Choose a pickup window";
    if (outsideSchedule && !trimmed) found.note = "Add a note explaining the pickup outside the normal schedule";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({ date, outsideSchedule, windowStart, windowEnd, note: outsideSchedule ? trimmed : null }, showServerError);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Suggest a pickup time</DialogTitle>
          <DialogDescription>
            The customer sees it on their tracking page and can accept it. The order stays Booked until they do.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-form" noValidate>
          <div className="flex items-start justify-between gap-component">
            <div className="flex flex-col gap-1">
              <Label htmlFor={fieldId("outside")} className="type-label text-foreground">
                Outside normal schedule
              </Label>
              <p id={fieldId("outside-hint")} className="type-caption text-muted-foreground">
                Any date and time the store agreed. A note is required.
              </p>
            </div>
            <Switch
              id={fieldId("outside")}
              checked={outsideSchedule}
              onCheckedChange={(checked) => {
                setOutsideSchedule(checked);
                setErrors({});
              }}
              aria-describedby={fieldId("outside-hint")}
            />
          </div>

          <FormField id={fieldId("date")} label="Pickup date" error={errors.date}>
            <DatePicker
              id={fieldId("date")}
              value={date}
              onChange={setDate}
              min={today}
              isDateDisabled={isDateDisabled}
              invalid={Boolean(errors.date)}
              describedBy={describedBy(fieldId("date"), undefined, errors.date)}
            />
          </FormField>

          {outsideSchedule ? (
            <div className="grid grid-cols-1 gap-form xs:grid-cols-2">
              <FormField id={fieldId("start")} label="From" error={errors.window}>
                <TimeSelect
                  id={fieldId("start")}
                  label="From"
                  value={customStart}
                  onChange={setCustomStart}
                  invalid={Boolean(errors.window)}
                  describedBy={describedBy(fieldId("start"), undefined, errors.window)}
                />
              </FormField>
              <FormField id={fieldId("end")} label="To">
                <TimeSelect id={fieldId("end")} label="To" value={customEnd} onChange={setCustomEnd} invalid={Boolean(errors.window)} />
              </FormField>
            </div>
          ) : (
            <FormField
              id={fieldId("window")}
              label="Pickup window"
              hint={windows.length === 0 ? "Your store has no pickup hours set. Use Outside normal schedule." : undefined}
              error={errors.window}
            >
              <Select value={windowKey} onValueChange={setWindowKey} disabled={windows.length === 0}>
                <SelectTrigger
                  id={fieldId("window")}
                  className="w-full"
                  aria-invalid={errors.window ? true : undefined}
                  aria-describedby={describedBy(fieldId("window"), undefined, errors.window)}
                >
                  <SelectValue placeholder="Choose a window" />
                </SelectTrigger>
                <SelectContent>
                  {windows.map((window) => (
                    <SelectItem key={window.start} value={`${window.start}-${window.end}`}>
                      {formatPickupWindow(window)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          {outsideSchedule && (
            <FormField id={fieldId("note")} label="Note" hint={NOTE_HINT} error={errors.note}>
              <Textarea
                id={fieldId("note")}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={SUGGESTION_NOTE_MAX}
                rows={2}
                aria-invalid={errors.note ? true : undefined}
                aria-describedby={describedBy(fieldId("note"), NOTE_HINT, errors.note)}
              />
            </FormField>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Back
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Suggest this time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
