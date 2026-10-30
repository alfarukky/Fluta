"use client";

import { CheckCircle2Icon, InfoIcon, LocateFixedIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { Coordinates } from "@/lib/location";
import { formatAreaChargeForCustomer } from "@/lib/money";
import { formatPickupWindow } from "@/lib/pickup-schedule";
import { addDaysToDateKey, fromDateKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { UNLISTED_AREA_ID } from "@/schemas/booking";
import { ADDRESS_MAX } from "@/schemas/field-limits";
import { AREA_NAME_MAX } from "@/schemas/fulfilment";
import type { BookingOptions } from "@/types/booking";

import { isShortAddress, windowKey, type BookingDraft, type DraftErrors } from "./booking-draft";
import { useCurrentLocation } from "./use-current-location";

interface PickupStepProps {
  options: BookingOptions;
  draft: BookingDraft;
  errors: DraftErrors;
  onChange: (patch: Partial<BookingDraft>) => void;
}

const ADDRESS_GUIDE = "Include house number, street, area, and a nearby landmark.";
// How long typing must pause before the address is checked for length.
const ADDRESS_CHECK_DELAY_MS = 700;

const CHOICE_CLASS =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 has-data-checked:border-primary has-data-checked:bg-accent/40";

// The area (with its charge), the address, and the preferred date and time.
// The time is a request: the store confirms it.
export function PickupStep({ options, draft, errors, onChange }: PickupStepProps) {
  const date = options.dates.find((option) => option.date === draft.date);
  // The short-address warning follows the address once typing pauses, so it
  // doesn't nag mid-word. Not on blur: the warning appearing as the customer
  // taps the next field would move that field from under their finger.
  const [settledAddress, setSettledAddress] = useState(draft.address);
  useEffect(() => {
    const timer = setTimeout(() => setSettledAddress(draft.address), ADDRESS_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft.address]);
  const shortAddress = !errors.address && isShortAddress(settledAddress);

  return (
    <div className="flex flex-col gap-form">
      <ChoiceGroup id="pickup-area" legend="Your area" error={errors.areaId}>
        <RadioGroup
          value={draft.areaId}
          onValueChange={(areaId) => onChange({ areaId })}
          aria-invalid={errors.areaId ? true : undefined}
          aria-describedby={errors.areaId ? "pickup-area-error" : "pickup-area-hint"}
          className="flex flex-col gap-2"
        >
          {options.areas.map((area) => (
            <Label key={area.id} htmlFor={`area-${area.id}`} className={CHOICE_CLASS}>
              <RadioGroupItem id={`area-${area.id}`} value={area.id} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 xs:flex-row xs:items-baseline xs:justify-between xs:gap-component">
                <span className="type-label wrap-break-word text-card-foreground">{area.name}</span>
                <span className="type-body-sm font-normal text-muted-foreground">
                  Pickup & delivery: {formatAreaChargeForCustomer(area)}
                </span>
              </span>
            </Label>
          ))}
          {options.defaultFee !== null && (
            <Label htmlFor="area-unlisted" className={CHOICE_CLASS}>
              <RadioGroupItem id="area-unlisted" value={UNLISTED_AREA_ID} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 xs:flex-row xs:items-baseline xs:justify-between xs:gap-component">
                <span className="type-label wrap-break-word text-card-foreground">My area isn&apos;t listed</span>
                <span className="type-body-sm font-normal text-muted-foreground">
                  Pickup & delivery: {formatAreaChargeForCustomer({ chargeType: "FIXED", fixedCharge: options.defaultFee })}
                </span>
              </span>
            </Label>
          )}
        </RadioGroup>
        <p id="pickup-area-hint" className="type-caption text-muted-foreground">
          One charge covers both pickup and delivery back to you.
        </p>
      </ChoiceGroup>

      {draft.areaId === UNLISTED_AREA_ID && options.defaultFee !== null && (
        <FormField id="pickup-area-name" label="Area name" hint="For example Gwarinpa or Lugbe." error={errors.areaName}>
          <Input
            id="pickup-area-name"
            value={draft.areaName}
            onChange={(event) => onChange({ areaName: event.target.value })}
            maxLength={AREA_NAME_MAX}
            autoComplete="address-level3"
            aria-invalid={errors.areaName ? true : undefined}
            aria-describedby={describedBy("pickup-area-name", "For example Gwarinpa or Lugbe.", errors.areaName)}
          />
        </FormField>
      )}

      <FormField id="pickup-address" label="Your address" hint="We'll pick up and deliver here." error={errors.address}>
        <Textarea
          id="pickup-address"
          name="street-address"
          autoComplete="street-address"
          value={draft.address}
          onChange={(event) => onChange({ address: event.target.value })}
          maxLength={ADDRESS_MAX}
          rows={2}
          placeholder="12 Admiralty Way, Lekki Phase 1, near Mega Plaza"
          aria-invalid={errors.address ? true : undefined}
          aria-describedby={[
            describedBy("pickup-address", "We'll pick up and deliver here.", errors.address),
            "pickup-address-guide",
            shortAddress && "pickup-address-warning",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        <p id="pickup-address-guide" className="type-caption text-muted-foreground">
          {ADDRESS_GUIDE}
        </p>
        <CurrentLocation location={draft.location} onChange={(location) => onChange({ location })} />
        {/* A warning only: Continue still works. */}
        <p aria-live="polite" className="empty:hidden">
          {shortAddress && (
            <span id="pickup-address-warning" className="type-caption flex items-start gap-1.5 text-foreground">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              This address looks short. Add a house number, street, or landmark so the store can find you.
            </span>
          )}
        </p>
      </FormField>

      <ChoiceGroup id="pickup-date" legend="Preferred pickup date" error={errors.date}>
        <RadioGroup
          value={draft.date}
          // A new date keeps the time only if that date offers it.
          onValueChange={(next) => {
            const windows = options.dates.find((option) => option.date === next)?.windows ?? [];
            const keep = windows.some((window) => windowKey(window.start, window.end) === draft.window);
            onChange({ date: next, window: keep ? draft.window : "" });
          }}
          aria-invalid={errors.date ? true : undefined}
          aria-describedby={errors.date ? "pickup-date-error" : undefined}
          className="grid grid-cols-2 gap-2 xs:grid-cols-3"
        >
          {options.dates.map((option) => (
            <Label key={option.date} htmlFor={`date-${option.date}`} className={cn(CHOICE_CLASS, "justify-start")}>
              <RadioGroupItem id={`date-${option.date}`} value={option.date} />
              <span className="type-body-sm font-medium text-card-foreground">{formatDateChoice(option.date, options.today)}</span>
            </Label>
          ))}
        </RadioGroup>
      </ChoiceGroup>

      {date && (
        <ChoiceGroup id="pickup-window" legend="Preferred pickup time" error={errors.window}>
          <RadioGroup
            value={draft.window}
            onValueChange={(window) => onChange({ window })}
            aria-invalid={errors.window ? true : undefined}
            aria-describedby={errors.window ? "pickup-window-error" : undefined}
            className="grid grid-cols-1 gap-2 xs:grid-cols-2"
          >
            {date.windows.map((window) => {
              const key = windowKey(window.start, window.end);
              return (
                <Label key={key} htmlFor={`window-${key}`} className={CHOICE_CLASS}>
                  <RadioGroupItem id={`window-${key}`} value={key} />
                  <span className="type-body-sm font-medium text-card-foreground">{formatPickupWindow(window)}</span>
                </Label>
              );
            })}
          </RadioGroup>
        </ChoiceGroup>
      )}

      <p className="type-body-sm flex items-start gap-2 rounded-lg bg-muted p-3 text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        This is a request, not a booked time. The store will confirm your pickup time.
      </p>
    </div>
  );
}

interface CurrentLocationProps {
  location: Coordinates | null;
  onChange: (location: Coordinates | null) => void;
}

// "Use my current location": permission is asked only on tap. The typed
// address stays the real one, the location only helps find it.
function CurrentLocation({ location, onChange }: CurrentLocationProps) {
  const found = useCallback((next: Coordinates) => onChange(next), [onChange]);
  const { status, request, reset } = useCurrentLocation(found);

  if (location) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <p role="status" className="type-body-sm flex items-start gap-2 text-foreground">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          Location added to help find your address
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            reset();
            onChange(null);
          }}
        >
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" variant="outline" onClick={request} disabled={status === "locating"} className="self-start">
        <LocateFixedIcon data-icon="inline-start" aria-hidden />
        {status === "locating" ? "Finding your location…" : "Use my current location"}
      </Button>
      <p aria-live="polite" className="empty:hidden">
        {status === "failed" && (
          <span className="type-caption flex items-start gap-1.5 text-foreground">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            Couldn&apos;t get your location. Please type your address.
          </span>
        )}
      </p>
    </div>
  );
}

interface ChoiceGroupProps {
  id: string;
  legend: string;
  error?: string;
  children: ReactNode;
}

function ChoiceGroup({ id, legend, error, children }: ChoiceGroupProps) {
  return (
    <fieldset className="flex flex-col gap-2" data-form-field>
      <legend className="type-label mb-2 text-foreground">{legend}</legend>
      {children}
      {error && (
        <p id={`${id}-error`} className="type-caption text-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// "Today", "Tomorrow", or "Mon 15 Jun".
function formatDateChoice(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDaysToDateKey(today, 1)) return "Tomorrow";
  const day = fromDateKey(date);
  return `${WEEKDAY.format(day)} ${DAY_MONTH.format(day)}`;
}
