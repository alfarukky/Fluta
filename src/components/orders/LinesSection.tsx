"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { describedBy, FormField } from "@/components/settings/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputWithPrefix } from "@/components/ui/input-with-prefix";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNaira, formatServicePrice } from "@/lib/money";
import { isWeighed } from "@/lib/quantity";
import {
  ADJUSTMENT_DESCRIPTION_MAX,
  ADJUSTMENT_KIND_LABELS,
  MAX_ADJUSTMENT_LINES,
  MAX_SERVICE_LINES,
  type AdjustmentKind,
} from "@/schemas/orders";
import type { OrderEntryService } from "@/types/orders";

import { addService, type AdjustmentDraft, type OrderDraft, type OrderReview, type ServiceLineDraft } from "./order-draft";
import { OrderSection } from "./OrderSection";

interface LinesSectionProps {
  draft: OrderDraft;
  onChange: (change: Partial<OrderDraft>) => void;
  errors: Record<string, string>;
  services: OrderEntryService[];
  review: OrderReview;
}

const ADJUSTMENT_KINDS = Object.keys(ADJUSTMENT_KIND_LABELS) as AdjustmentKind[];

function newKey(): string {
  return crypto.randomUUID();
}

export function LinesSection({ draft, onChange, errors, services, review }: LinesSectionProps) {
  const id = useId();
  // The picker resets after each pick, so the same service can be picked again.
  const [pickerKey, setPickerKey] = useState(0);
  const byId = new Map(services.map((service) => [service.id, service]));
  const totals = new Map(review.serviceLines.map((line) => [line.key, line.lineTotal]));

  function pick(serviceId: string) {
    const service = byId.get(serviceId);
    setPickerKey((key) => key + 1);
    if (!service) return;
    const result = addService(draft.serviceLines, service, newKey());
    if (result.combined) {
      toast.info(
        isWeighed(service.pricingType)
          ? `${service.name} is already on this order. Enter its total weight.`
          : `Added 1 more to ${service.name}`,
      );
    }
    onChange({ serviceLines: result.lines });
  }

  function updateLine(key: string, change: Partial<ServiceLineDraft>) {
    onChange({ serviceLines: draft.serviceLines.map((line) => (line.key === key ? { ...line, ...change } : line)) });
  }

  function updateAdjustment(key: string, change: Partial<AdjustmentDraft>) {
    onChange({ adjustments: draft.adjustments.map((line) => (line.key === key ? { ...line, ...change } : line)) });
  }

  const categories = groupByCategory(services);
  const linesError = errors.serviceLines;

  return (
    <OrderSection title="Lines" description="Prices come from your service catalogue.">
      {draft.serviceLines.length === 0 ? (
        <p className={linesError ? "type-body-sm text-error" : "type-body-sm text-muted-foreground"}>
          {linesError ?? "No services yet. Add at least one."}
        </p>
      ) : (
        <ul className="flex flex-col gap-component" aria-label="Services on this order">
          {draft.serviceLines.map((line, index) => {
            const service = byId.get(line.serviceId);
            if (!service) return null;
            return (
              <ServiceLineRow
                key={line.key}
                idPrefix={`${id}-line-${line.key}`}
                line={line}
                service={service}
                lineTotal={totals.get(line.key) ?? null}
                errors={{
                  serviceId: errors[`serviceLines.${index}.serviceId`],
                  quantity: errors[`serviceLines.${index}.quantity`],
                  estimate: errors[`serviceLines.${index}.estimate`],
                }}
                onChange={(change) => updateLine(line.key, change)}
                onRemove={() => onChange({ serviceLines: draft.serviceLines.filter((other) => other.key !== line.key) })}
              />
            );
          })}
        </ul>
      )}

      <Select key={pickerKey} onValueChange={pick} disabled={draft.serviceLines.length >= MAX_SERVICE_LINES}>
        <SelectTrigger className="w-full md:w-80" aria-label="Add a service">
          <PlusIcon className="text-muted-foreground" aria-hidden />
          <SelectValue placeholder="Add a service" />
        </SelectTrigger>
        <SelectContent>
          {categories.map(([category, items]) => (
            <SelectGroup key={category}>
              <SelectLabel>{category}</SelectLabel>
              {items.map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name} · {formatServicePrice(service)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      <div className="flex flex-col gap-component border-t border-border pt-form">
        <div className="flex flex-col gap-1">
          <h3 className="type-label text-foreground">Others</h3>
          <p className="type-caption text-muted-foreground">Extra charges or discounts, like express service.</p>
        </div>
        {errors.adjustments && <p className="type-caption text-error">{errors.adjustments}</p>}
        {draft.adjustments.length > 0 && (
          <ul className="flex flex-col gap-component" aria-label="Others">
            {draft.adjustments.map((line, index) => (
              <AdjustmentRow
                key={line.key}
                idPrefix={`${id}-other-${line.key}`}
                line={line}
                errors={{
                  description: errors[`adjustments.${index}.description`],
                  kind: errors[`adjustments.${index}.kind`],
                  amount: errors[`adjustments.${index}.amount`],
                }}
                onChange={(change) => updateAdjustment(line.key, change)}
                onRemove={() => onChange({ adjustments: draft.adjustments.filter((other) => other.key !== line.key) })}
              />
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={draft.adjustments.length >= MAX_ADJUSTMENT_LINES}
          onClick={() =>
            onChange({ adjustments: [...draft.adjustments, { key: newKey(), description: "", kind: "CHARGE", amount: "" }] })
          }
        >
          <PlusIcon data-icon="inline-start" aria-hidden />
          Add Others line
        </Button>
      </div>
    </OrderSection>
  );
}

function groupByCategory(services: readonly OrderEntryService[]): [string, OrderEntryService[]][] {
  const groups = new Map<string, OrderEntryService[]>();
  for (const service of services) {
    const category = service.category ?? "Other services";
    groups.set(category, [...(groups.get(category) ?? []), service]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

interface ServiceLineRowProps {
  idPrefix: string;
  line: ServiceLineDraft;
  service: OrderEntryService;
  lineTotal: number | null;
  errors: { serviceId?: string; quantity?: string; estimate?: string };
  onChange: (change: Partial<ServiceLineDraft>) => void;
  onRemove: () => void;
}

function ServiceLineRow({ idPrefix, line, service, lineTotal, errors, onChange, onRemove }: ServiceLineRowProps) {
  const weighed = isWeighed(service.pricingType);
  const unweighed = weighed && line.quantity.trim() === "";
  const quantityHint = weighed ? "Leave empty if the clothes aren't weighed yet." : undefined;

  return (
    <li className="flex flex-col gap-component rounded-lg border border-border p-card">
      <div className="flex items-start justify-between gap-component">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="type-label text-foreground">{service.name}</span>
          <span className="type-caption text-muted-foreground">{formatServicePrice(service)}</span>
          {errors.serviceId && <span className="type-caption text-error">{errors.serviceId}</span>}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${service.name}`}>
          <Trash2Icon aria-hidden />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-form xs:grid-cols-2">
        <FormField id={`${idPrefix}-quantity`} label={weighed ? "Weight (kg)" : "Quantity"} hint={quantityHint} error={errors.quantity}>
          <Input
            id={`${idPrefix}-quantity`}
            value={line.quantity}
            onChange={(event) => onChange({ quantity: event.target.value })}
            inputMode={weighed ? "decimal" : "numeric"}
            autoComplete="off"
            maxLength={7}
            aria-invalid={errors.quantity ? true : undefined}
            aria-describedby={describedBy(`${idPrefix}-quantity`, quantityHint, errors.quantity)}
          />
        </FormField>
        {unweighed && (
          <FormField
            id={`${idPrefix}-estimate`}
            label="Customer's estimate (kg, optional)"
            error={errors.estimate}
          >
            <Input
              id={`${idPrefix}-estimate`}
              value={line.estimate}
              onChange={(event) => onChange({ estimate: event.target.value })}
              inputMode="decimal"
              autoComplete="off"
              maxLength={7}
              aria-invalid={errors.estimate ? true : undefined}
              aria-describedby={describedBy(`${idPrefix}-estimate`, undefined, errors.estimate)}
            />
          </FormField>
        )}
      </div>
      <div className="flex items-center justify-between gap-component">
        {unweighed ? <Badge variant="warning">Weigh later</Badge> : <span />}
        <span className="type-label text-foreground" aria-label={`${service.name} line total`}>
          {lineTotal === null ? "—" : formatNaira(lineTotal)}
        </span>
      </div>
    </li>
  );
}

interface AdjustmentRowProps {
  idPrefix: string;
  line: AdjustmentDraft;
  errors: { description?: string; kind?: string; amount?: string };
  onChange: (change: Partial<AdjustmentDraft>) => void;
  onRemove: () => void;
}

function AdjustmentRow({ idPrefix, line, errors, onChange, onRemove }: AdjustmentRowProps) {
  return (
    <li className="flex flex-col gap-component rounded-lg border border-border p-card">
      <div className="flex items-start gap-component">
        <div className="flex-1">
          <FormField id={`${idPrefix}-description`} label="Description" error={errors.description}>
            <Input
              id={`${idPrefix}-description`}
              value={line.description}
              onChange={(event) => onChange({ description: event.target.value })}
              maxLength={ADJUSTMENT_DESCRIPTION_MAX}
              autoComplete="off"
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={describedBy(`${idPrefix}-description`, undefined, errors.description)}
            />
          </FormField>
        </div>
        <Button type="button" variant="ghost" size="icon" className="mt-7" onClick={onRemove} aria-label="Remove this Others line">
          <Trash2Icon aria-hidden />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-form xs:grid-cols-2">
        <FormField id={`${idPrefix}-kind`} label="Type" error={errors.kind}>
          <Select
            value={line.kind}
            onValueChange={(value) => {
              const kind = ADJUSTMENT_KINDS.find((candidate) => candidate === value);
              if (kind) onChange({ kind });
            }}
          >
            <SelectTrigger id={`${idPrefix}-kind`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADJUSTMENT_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {ADJUSTMENT_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id={`${idPrefix}-amount`} label="Amount" error={errors.amount}>
          <InputWithPrefix
            id={`${idPrefix}-amount`}
            prefix={line.kind === "DISCOUNT" ? "−₦" : "₦"}
            value={line.amount}
            onChange={(event) => onChange({ amount: event.target.value })}
            inputMode="decimal"
            autoComplete="off"
            maxLength={20}
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={describedBy(`${idPrefix}-amount`, undefined, errors.amount)}
          />
        </FormField>
      </div>
    </li>
  );
}
