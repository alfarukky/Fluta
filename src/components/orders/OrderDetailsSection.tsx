"use client";

import { useId } from "react";

import { TimeSelect } from "@/components/fulfilment/TimeSelect";
import { describedBy, FormField } from "@/components/settings/FormField";
import { DatePicker } from "@/components/shared/DatePicker";
import { Input } from "@/components/ui/input";
import { InputWithPrefix } from "@/components/ui/input-with-prefix";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { FulfilmentType } from "@/generated/prisma/enums";
import { formatAreaCharge } from "@/lib/money";
import { FULFILMENT_TYPE_LABELS, ORDER_CHANNEL_LABELS, STAFF_CHANNELS, type StaffChannel } from "@/lib/orders";
import { formatPickupWindow, getPickupWindows, type PickupSchedule } from "@/lib/pickup-schedule";
import { fromDateKey } from "@/lib/time";
import { AREA_NAME_MAX } from "@/schemas/fulfilment";
import { ADDRESS_MAX, INTERNAL_NOTE_MAX } from "@/schemas/orders";
import type { OrderEntryArea } from "@/types/orders";

import { needsEnteredCharge, OUT_OF_AREA, windowKey, type OrderDraft } from "./order-draft";
import { OrderSection } from "./OrderSection";

export interface OrderEntrySettings {
  dropOffEnabled: boolean;
  pickupDeliveryEnabled: boolean;
  schedule: PickupSchedule;
  // Closed dates from today, "YYYY-MM-DD".
  closedDates: string[];
  today: string;
}

interface OrderDetailsSectionProps {
  draft: OrderDraft;
  onChange: (change: Partial<OrderDraft>) => void;
  errors: Record<string, string>;
  areas: OrderEntryArea[];
  settings: OrderEntrySettings;
}

const CHANNEL_HINTS: Record<StaffChannel, string> = {
  COUNTER: "The customer is here",
  PHONE: "Booked by phone",
  WHATSAPP: "Booked on WhatsApp",
};

const FULFILMENT_HINTS: Record<FulfilmentType, string> = {
  DROP_OFF: "The customer brings the clothes and collects them",
  PICKUP_DELIVERY: "You pick up and deliver to one address",
};

export function OrderDetailsSection({ draft, onChange, errors, areas, settings }: OrderDetailsSectionProps) {
  const id = useId();
  const fieldId = (name: string) => `${id}-${name}`;
  const fulfilmentOptions = (["DROP_OFF", "PICKUP_DELIVERY"] as const).filter((type) =>
    type === "DROP_OFF" ? settings.dropOffEnabled : settings.pickupDeliveryEnabled,
  );
  const noteRequired = draft.fulfilmentType === "PICKUP_DELIVERY" && draft.outsideSchedule;
  const noteHint = noteRequired
    ? "Required: explain the pickup outside the normal schedule. Never shown to customers."
    : "Optional. Never shown to customers.";

  return (
    <OrderSection title="Order details">
      <ChoiceGroup
        legend="How did the order come in?"
        idPrefix={fieldId("channel")}
        value={draft.channel}
        options={STAFF_CHANNELS.map((channel) => ({ value: channel, label: ORDER_CHANNEL_LABELS[channel], hint: CHANNEL_HINTS[channel] }))}
        onChange={(channel) => onChange({ channel })}
        error={errors.channel}
      />

      {fulfilmentOptions.length > 1 ? (
        <ChoiceGroup
          legend="Fulfilment"
          idPrefix={fieldId("fulfilment")}
          value={draft.fulfilmentType}
          options={fulfilmentOptions.map((type) => ({ value: type, label: FULFILMENT_TYPE_LABELS[type], hint: FULFILMENT_HINTS[type] }))}
          onChange={(fulfilmentType) => onChange({ fulfilmentType })}
          error={errors.fulfilmentType}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <p className="type-label text-foreground">Fulfilment</p>
          <p className="type-body-sm text-muted-foreground">
            {FULFILMENT_TYPE_LABELS[draft.fulfilmentType]}: the only option your store offers.
          </p>
          {errors.fulfilmentType && <p className="type-caption text-error">{errors.fulfilmentType}</p>}
        </div>
      )}

      {draft.fulfilmentType === "PICKUP_DELIVERY" && (
        <PickupFields draft={draft} onChange={onChange} errors={errors} areas={areas} settings={settings} fieldId={fieldId} />
      )}

      <FormField id={fieldId("note")} label="Internal note" hint={noteHint} error={errors.internalNote}>
        <Textarea
          id={fieldId("note")}
          value={draft.internalNote}
          onChange={(event) => onChange({ internalNote: event.target.value })}
          maxLength={INTERNAL_NOTE_MAX}
          rows={3}
          aria-invalid={errors.internalNote ? true : undefined}
          aria-describedby={describedBy(fieldId("note"), noteHint, errors.internalNote)}
        />
      </FormField>
    </OrderSection>
  );
}

interface ChoiceGroupProps<T extends string> {
  legend: string;
  idPrefix: string;
  value: T;
  options: { value: T; label: string; hint: string }[];
  onChange: (value: T) => void;
  error?: string;
}

function ChoiceGroup<T extends string>({ legend, idPrefix, value, options, onChange, error }: ChoiceGroupProps<T>) {
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${idPrefix}-error` : undefined}>
      <legend className="type-label mb-2 text-foreground">{legend}</legend>
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          const option = options.find((candidate) => candidate.value === next);
          if (option) onChange(option.value);
        }}
        className="grid grid-cols-1 gap-2 md:grid-cols-3"
      >
        {options.map((option) => (
          <Label
            key={option.value}
            htmlFor={`${idPrefix}-${option.value}`}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-data-checked:border-primary has-data-checked:bg-accent/40"
          >
            <RadioGroupItem id={`${idPrefix}-${option.value}`} value={option.value} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="type-label text-foreground">{option.label}</span>
              <span className="type-caption font-normal text-muted-foreground">{option.hint}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      {error && (
        <p id={`${idPrefix}-error`} className="type-caption text-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

interface PickupFieldsProps extends Omit<OrderDetailsSectionProps, "settings"> {
  settings: OrderEntrySettings;
  fieldId: (name: string) => string;
}

function PickupFields({ draft, onChange, errors, areas, settings, fieldId }: PickupFieldsProps) {
  const { schedule, closedDates, today } = settings;
  const windows = schedule.openTime && schedule.closeTime ? getPickupWindows(schedule.openTime, schedule.closeTime) : [];
  const closed = new Set(closedDates);
  const isDateDisabled = (key: string) =>
    !draft.outsideSchedule && (closed.has(key) || !schedule.activeDays.includes(fromDateKey(key).getUTCDay()));
  const area = areas.find((candidate) => candidate.id === draft.areaChoice);
  const enterCharge = needsEnteredCharge(draft, areas);

  const areaError = errors["pickup.area"] ?? errors["pickup.area.areaId"] ?? errors.pickup;
  const windowError = errors["pickup.window"] ?? errors["pickup.windowStart"] ?? errors["pickup.windowEnd"];
  const chargeHint = draft.areaChoice === OUT_OF_AREA
    ? "Outside your service areas: enter the charge you agreed, or 0."
    : "This area's charge is agreed per order: enter it, or 0.";
  const scheduleHint = "For a pickup the store agreed outside its days or hours. A note is required.";

  return (
    <div className="flex flex-col gap-form rounded-lg border border-border p-card">
      <FormField id={fieldId("area")} label="Service area" error={areaError}>
        <Select value={draft.areaChoice} onValueChange={(areaChoice) => onChange({ areaChoice })}>
          <SelectTrigger
            id={fieldId("area")}
            className="w-full"
            aria-invalid={areaError ? true : undefined}
            aria-describedby={describedBy(fieldId("area"), undefined, areaError)}
          >
            <SelectValue placeholder="Choose an area" />
          </SelectTrigger>
          <SelectContent>
            {areas.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name} · {formatAreaCharge(option)}
              </SelectItem>
            ))}
            {areas.length > 0 && <SelectSeparator />}
            <SelectItem value={OUT_OF_AREA}>Outside our service areas</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      {draft.areaChoice === OUT_OF_AREA && (
        <FormField id={fieldId("area-name")} label="Area name" hint="Kept on this order only." error={errors["pickup.area.name"]}>
          <Input
            id={fieldId("area-name")}
            value={draft.outOfAreaName}
            onChange={(event) => onChange({ outOfAreaName: event.target.value })}
            maxLength={AREA_NAME_MAX}
            autoComplete="off"
            aria-invalid={errors["pickup.area.name"] ? true : undefined}
            aria-describedby={describedBy(fieldId("area-name"), "Kept on this order only.", errors["pickup.area.name"])}
          />
        </FormField>
      )}

      {area && !enterCharge && (
        <p className="type-body-sm text-muted-foreground">
          Pickup & delivery charge: <span className="font-medium text-foreground">{formatAreaCharge(area)}</span>
        </p>
      )}
      {enterCharge && (
        <FormField id={fieldId("charge")} label="Pickup & delivery charge" hint={chargeHint} error={errors["pickup.charge"]}>
          <InputWithPrefix
            id={fieldId("charge")}
            prefix="₦"
            value={draft.charge}
            onChange={(event) => onChange({ charge: event.target.value })}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            maxLength={20}
            aria-invalid={errors["pickup.charge"] ? true : undefined}
            aria-describedby={describedBy(fieldId("charge"), chargeHint, errors["pickup.charge"])}
          />
        </FormField>
      )}

      <FormField id={fieldId("address")} label="Address" hint="Used for both pickup and delivery." error={errors["pickup.address"]}>
        <Textarea
          id={fieldId("address")}
          value={draft.address}
          onChange={(event) => onChange({ address: event.target.value })}
          maxLength={ADDRESS_MAX}
          rows={2}
          aria-invalid={errors["pickup.address"] ? true : undefined}
          aria-describedby={describedBy(fieldId("address"), "Used for both pickup and delivery.", errors["pickup.address"])}
        />
      </FormField>

      <div className="flex items-start justify-between gap-component">
        <div className="flex flex-col gap-1">
          <Label htmlFor={fieldId("outside")} className="type-label text-foreground">
            Outside normal schedule
          </Label>
          <p id={fieldId("outside-hint")} className="type-caption text-muted-foreground">
            {scheduleHint}
          </p>
        </div>
        <Switch
          id={fieldId("outside")}
          checked={draft.outsideSchedule}
          onCheckedChange={(outsideSchedule) => onChange({ outsideSchedule })}
          aria-describedby={fieldId("outside-hint")}
        />
      </div>

      <FormField id={fieldId("date")} label="Pickup date" error={errors["pickup.date"]}>
        <DatePicker
          id={fieldId("date")}
          value={draft.date}
          onChange={(date) => onChange({ date })}
          min={today}
          isDateDisabled={isDateDisabled}
          invalid={Boolean(errors["pickup.date"])}
          describedBy={describedBy(fieldId("date"), undefined, errors["pickup.date"])}
        />
      </FormField>

      {draft.outsideSchedule ? (
        <div className="grid grid-cols-1 gap-form md:grid-cols-2">
          <FormField id={fieldId("start")} label="From" error={windowError}>
            <TimeSelect
              id={fieldId("start")}
              label="From"
              value={draft.customStart}
              onChange={(customStart) => onChange({ customStart })}
              invalid={Boolean(windowError)}
              describedBy={describedBy(fieldId("start"), undefined, windowError)}
            />
          </FormField>
          <FormField id={fieldId("end")} label="To">
            <TimeSelect
              id={fieldId("end")}
              label="To"
              value={draft.customEnd}
              onChange={(customEnd) => onChange({ customEnd })}
              invalid={Boolean(windowError)}
            />
          </FormField>
        </div>
      ) : (
        <FormField
          id={fieldId("window")}
          label="Pickup window"
          hint={windows.length === 0 ? "Your store has no pickup hours set. Use Outside normal schedule." : undefined}
          error={windowError}
        >
          <Select value={draft.windowKey} onValueChange={(key) => onChange({ windowKey: key })} disabled={windows.length === 0}>
            <SelectTrigger
              id={fieldId("window")}
              className="w-full"
              aria-invalid={windowError ? true : undefined}
              aria-describedby={describedBy(fieldId("window"), undefined, windowError)}
            >
              <SelectValue placeholder="Choose a window" />
            </SelectTrigger>
            <SelectContent>
              {windows.map((window) => (
                <SelectItem key={window.start} value={windowKey(window.start, window.end)}>
                  {formatPickupWindow(window)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
    </div>
  );
}
