"use client";

import { MinusIcon, PlusIcon } from "lucide-react";

import { QuantityStepper } from "@/components/forms/QuantityStepper";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatServicePrice } from "@/lib/money";
import { CUSTOMER_NOTE_MAX } from "@/schemas/field-limits";
import type { BookingService } from "@/types/booking";

import type { BookingDraft, DraftErrors } from "./booking-draft";

interface ServicesStepProps {
  services: BookingService[];
  lines: BookingDraft["lines"];
  note: string;
  errors: DraftErrors;
  onChange: (lines: BookingDraft["lines"]) => void;
  onNoteChange: (note: string) => void;
}

const NOTE_HINT = "Optional. For example: 2 curtains, 1 rug, or please iron the shirts only.";

// Active services with their prices. Added ones ask how many (an estimate on
// items the store inspects). Anything not listed goes in
// the note, which the store reads and prices itself.
export function ServicesStep({ services, lines, note, errors, onChange, onNoteChange }: ServicesStepProps) {
  const categories = groupByCategory(services);

  function add(service: BookingService) {
    onChange([...lines, { serviceId: service.id, amount: "1" }]);
  }
  function remove(serviceId: string) {
    onChange(lines.filter((line) => line.serviceId !== serviceId));
  }
  function setAmount(serviceId: string, amount: string) {
    onChange(lines.map((line) => (line.serviceId === serviceId ? { ...line, amount } : line)));
  }

  return (
    // The whole list is marked invalid when nothing is chosen, so the form
    // scrolls here and focuses the first Add button.
    <div
      aria-invalid={errors.services ? true : undefined}
      aria-describedby={errors.services ? "services-error" : undefined}
      data-form-field
      className="flex flex-col gap-section"
    >
      {errors.services && (
        <p id="services-error" className="type-body-sm text-error">
          {errors.services}
        </p>
      )}
      {categories.map(([category, items]) => (
        <section key={category ?? ""} aria-label={category ?? "Services"} className="flex flex-col gap-component">
          {category && <h3 className="type-label text-muted-foreground">{category}</h3>}
          <ul className="flex flex-col gap-3">
            {items.map((service) => {
              const line = lines.find((candidate) => candidate.serviceId === service.id);
              return (
                <li key={service.id} className="flex flex-col gap-component rounded-xl border border-border bg-card p-card">
                  <div className="flex items-start justify-between gap-component">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="type-label wrap-break-word text-card-foreground">{service.name}</span>
                      <span className="type-body-sm text-muted-foreground">{formatServicePrice(service)}</span>
                    </div>
                    {line ? (
                      <Button type="button" variant="ghost" onClick={() => remove(service.id)} aria-label={`Remove ${service.name}`}>
                        <MinusIcon aria-hidden />
                        Remove
                      </Button>
                    ) : (
                      <Button type="button" variant="secondary" onClick={() => add(service)} aria-label={`Add ${service.name}`}>
                        <PlusIcon aria-hidden />
                        Add
                      </Button>
                    )}
                  </div>
                  {line && (
                    <AmountField
                      service={service}
                      value={line.amount}
                      error={errors[`service.${service.id}`]}
                      onChange={(amount) => setAmount(service.id, amount)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <FormField id="booking-note" label="Anything else? Other items or instructions" hint={NOTE_HINT} error={errors.note}>
        <Textarea
          id="booking-note"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          maxLength={CUSTOMER_NOTE_MAX}
          rows={3}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={describedBy("booking-note", NOTE_HINT, errors.note)}
        />
      </FormField>
    </div>
  );
}

interface AmountFieldProps {
  service: BookingService;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

function AmountField({ service, value, error, onChange }: AmountFieldProps) {
  const id = `amount-${service.id}`;
  const hint = service.requiresQuote ? "The store will confirm the price after checking your items." : undefined;
  return (
    <FormField id={id} label="How many" hint={hint} error={error}>
      <QuantityStepper
        id={id}
        value={value}
        onChange={onChange}
        label={`how many ${service.name}`}
        maxLength={7}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
      />
    </FormField>
  );
}

// Services without a category first, then each category alphabetically.
function groupByCategory(services: readonly BookingService[]): [string | null, BookingService[]][] {
  const groups = new Map<string | null, BookingService[]>();
  for (const service of services) groups.set(service.category, [...(groups.get(service.category) ?? []), service]);
  return [...groups.entries()].sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)));
}
