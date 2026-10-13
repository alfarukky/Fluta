"use client";

import { PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { issueRevision } from "@/actions/quotes";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputWithPrefix } from "@/components/ui/input-with-prefix";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatAreaCharge, formatNaira, formatServicePrice } from "@/lib/money";
import { isWeighed } from "@/lib/quantity";
import { formatDifference, REVISION_REASON_MAX } from "@/lib/quotes";
import { AREA_NAME_MAX } from "@/schemas/fulfilment";
import { MAX_ADJUSTMENT_LINES, MAX_SERVICE_LINES } from "@/schemas/orders";
import type { OrderEntryArea, OrderEntryService, QuoteEditorData } from "@/types/orders";

import { AdjustmentRow, groupByCategory } from "./LinesSection";
import { OUT_OF_AREA } from "./order-draft";
import { OrderSection } from "./OrderSection";
import {
  addQuoteService,
  CURRENT_AREA,
  initialQuoteDraft,
  isChargeEntered,
  quantityInput,
  reviewQuoteDraft,
  toIssueRevisionRequest,
  type QuoteDraft,
  type QuoteLineDraft,
} from "./quote-draft";

interface QuoteEditorProps {
  editor: QuoteEditorData;
  services: OrderEntryService[];
  areas: OrderEntryArea[];
}

// Lines → Pickup & delivery → Reason → Summary → Send for approval. Every
// change becomes a new quote revision the customer must approve.
export function QuoteEditor({ editor, services, areas }: QuoteEditorProps) {
  const id = useId();
  const router = useRouter();
  const [draft, setDraft] = useState<QuoteDraft>(() => initialQuoteDraft(editor));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pickerKey, setPickerKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  const review = reviewQuoteDraft(draft, editor, areas);
  const orderHref = `/orders/${editor.orderId}`;
  const busy = pending || sent;

  function change(update: Partial<QuoteDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function updateLine(key: string, update: Partial<QuoteLineDraft>) {
    change({ lines: draft.lines.map((line) => (line.key === key ? { ...line, ...update } : line)) });
  }

  function pick(serviceId: string) {
    setPickerKey((key) => key + 1);
    const service = services.find((candidate) => candidate.id === serviceId);
    if (service) change({ lines: addQuoteService(draft.lines, service, crypto.randomUUID()) });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const request = toIssueRevisionRequest(draft, editor, areas);
    startTransition(async () => {
      const result = await issueRevision(request);
      if (result.ok) {
        setSent(true);
        toast.success(result.message);
        router.push(orderHref);
        return;
      }
      setErrors(result.fieldErrors ?? {});
      toast.error(result.message);
    });
  }

  const reasonHint = editor.reasonRequired
    ? "Visible to the customer. Required: explain what changed."
    : "Visible to the customer. Optional for the first priced quote.";
  const chargeEntered = isChargeEntered(draft, editor, areas);

  return (
    <form onSubmit={submit} className="flex flex-col gap-section" noValidate>
      {editor.hasPendingRevision && (
        <p role="note" className="type-body-sm flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-card text-foreground">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          This replaces the quote waiting for customer approval.
        </p>
      )}

      <OrderSection title="Lines" description="Lines already on the order keep their price. Added services use today's price.">
        {draft.lines.length === 0 ? (
          <p className={errors.lines ? "type-body-sm text-error" : "type-body-sm text-muted-foreground"}>
            {errors.lines ?? "No services. Add at least one."}
          </p>
        ) : (
          <ul className="flex flex-col gap-component" aria-label="Services on this quote">
            {draft.lines.map((line, index) => (
              <QuoteLineRow
                key={line.key}
                idPrefix={`${id}-line-${index}`}
                line={line}
                lineTotal={review.lineTotals.get(line.key) ?? null}
                error={errors[`lines.${index}.quantity`] ?? errors[`lines.${index}.serviceId`] ?? errors[`lines.${index}`]}
                onChange={(update) => updateLine(line.key, update)}
                onRemove={() => change({ lines: draft.lines.filter((other) => other.key !== line.key) })}
              />
            ))}
          </ul>
        )}

        <Select key={pickerKey} onValueChange={pick} disabled={draft.lines.length >= MAX_SERVICE_LINES}>
          <SelectTrigger className="w-full md:w-80" aria-label="Add a service">
            <PlusIcon className="text-muted-foreground" aria-hidden />
            <SelectValue placeholder="Add a service" />
          </SelectTrigger>
          <SelectContent>
            {groupByCategory(services).map(([category, items]) => (
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
            <p className="type-caption text-muted-foreground">Extra charges or discounts, like stain removal.</p>
          </div>
          {errors.adjustments && <p className="type-caption text-error">{errors.adjustments}</p>}
          {draft.adjustments.length > 0 && (
            <ul className="flex flex-col gap-component" aria-label="Others">
              {draft.adjustments.map((line, index) => (
                <AdjustmentRow
                  key={line.key}
                  idPrefix={`${id}-other-${index}`}
                  line={line}
                  errors={{
                    description: errors[`adjustments.${index}.description`],
                    kind: errors[`adjustments.${index}.kind`],
                    amount: errors[`adjustments.${index}.amount`],
                  }}
                  onChange={(update) =>
                    change({ adjustments: draft.adjustments.map((other) => (other.key === line.key ? { ...other, ...update } : other)) })
                  }
                  onRemove={() => change({ adjustments: draft.adjustments.filter((other) => other.key !== line.key) })}
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
              change({
                adjustments: [...draft.adjustments, { key: crypto.randomUUID(), description: "", kind: "CHARGE", amount: "" }],
              })
            }
          >
            <PlusIcon data-icon="inline-start" aria-hidden />
            Add Others line
          </Button>
        </div>
      </OrderSection>

      {editor.pickup && (
        <OrderSection title="Pickup & delivery">
          <FormField id={`${id}-area`} label="Service area" error={errors.area ?? errors["area.areaId"]}>
            <Select value={draft.areaChoice} onValueChange={(areaChoice) => change({ areaChoice })}>
              <SelectTrigger id={`${id}-area`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CURRENT_AREA}>
                  {editor.pickup.areaName ?? "Current area"}
                  {editor.pickup.isOutOfArea ? " (outside our areas)" : ""} · current
                </SelectItem>
                <SelectSeparator />
                {areas.map((area) => (
                  <SelectItem key={area.id} value={area.id}>
                    {area.name} · {formatAreaCharge(area)}
                  </SelectItem>
                ))}
                <SelectItem value={OUT_OF_AREA}>Outside our service areas</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {draft.areaChoice === OUT_OF_AREA && (
            <FormField id={`${id}-area-name`} label="Area name" hint="Kept on this order only." error={errors["area.name"]}>
              <Input
                id={`${id}-area-name`}
                value={draft.outOfAreaName}
                onChange={(event) => change({ outOfAreaName: event.target.value })}
                maxLength={AREA_NAME_MAX}
                autoComplete="off"
                aria-invalid={errors["area.name"] ? true : undefined}
                aria-describedby={describedBy(`${id}-area-name`, "Kept on this order only.", errors["area.name"])}
              />
            </FormField>
          )}
          {chargeEntered ? (
            <FormField id={`${id}-charge`} label="Pickup & delivery charge" hint="Enter the agreed charge, or 0." error={errors.charge}>
              <InputWithPrefix
                id={`${id}-charge`}
                prefix="₦"
                value={draft.charge}
                onChange={(event) => change({ charge: event.target.value })}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                maxLength={20}
                aria-invalid={errors.charge ? true : undefined}
                aria-describedby={describedBy(`${id}-charge`, "Enter the agreed charge, or 0.", errors.charge)}
              />
            </FormField>
          ) : (
            <p className="type-body-sm text-muted-foreground">
              Pickup & delivery charge:{" "}
              <span className="font-medium text-foreground">{review.charge === null ? "—" : formatNaira(review.charge)}</span>
              {draft.areaChoice === CURRENT_AREA && " (as agreed on this order)"}
            </p>
          )}
        </OrderSection>
      )}

      <OrderSection title="Reason">
        <FormField id={`${id}-reason`} label="Reason" hint={reasonHint} error={errors.reason}>
          <Textarea
            id={`${id}-reason`}
            value={draft.reason}
            onChange={(event) => change({ reason: event.target.value })}
            maxLength={REVISION_REASON_MAX}
            rows={2}
            placeholder={editor.reasonRequired ? "For example: Actual weight 4.2 kg" : undefined}
            required={editor.reasonRequired}
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={describedBy(`${id}-reason`, reasonHint, errors.reason)}
          />
        </FormField>
      </OrderSection>

      <OrderSection title="Summary">
        <dl className="flex flex-col gap-2">
          <SummaryRow label="Last approved total" value={editor.approvedTotal === null ? "None yet" : formatNaira(editor.approvedTotal)} />
          <SummaryRow label="New total" value={formatNaira(review.total)} strong />
          <SummaryRow label="Difference" value={review.difference === null ? "—" : formatDifference(review.difference)} />
        </dl>
        {!review.fullyPriced && (
          <p className="type-caption text-muted-foreground">
            Enter every weight and quantity{editor.pickup ? ", and the pickup & delivery charge," : ""} before sending.
          </p>
        )}
        <p className="type-caption text-muted-foreground">
          The customer must approve the new total. Payments follow the last approved total until then.
        </p>
      </OrderSection>

      <div className="flex flex-col-reverse gap-component xs:flex-row xs:justify-end">
        <Button asChild variant="ghost" className="w-full xs:w-auto">
          <Link href={orderHref}>Cancel</Link>
        </Button>
        <Button type="submit" size="lg" disabled={busy} aria-busy={busy || undefined} className="w-full xs:w-auto">
          {busy ? "Sending…" : "Send for approval"}
        </Button>
      </div>
    </form>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-component">
      <dt className={strong ? "type-label text-foreground" : "type-body-sm text-muted-foreground"}>{label}</dt>
      <dd className={strong ? "type-h3 text-foreground" : "type-body-sm text-foreground"} aria-live={strong ? "polite" : undefined}>
        {value}
      </dd>
    </div>
  );
}

interface QuoteLineRowProps {
  idPrefix: string;
  line: QuoteLineDraft;
  lineTotal: number | null;
  error?: string;
  onChange: (update: Partial<QuoteLineDraft>) => void;
  onRemove: () => void;
}

function QuoteLineRow({ idPrefix, line, lineTotal, error, onChange, onRemove }: QuoteLineRowProps) {
  const weighed = isWeighed(line.pricingType);
  const added = line.source.kind === "new";
  const price = formatServicePrice({ pricingType: line.pricingType, price: line.unitPrice, requiresQuote: false });
  const hint =
    weighed && line.estimate !== null ? `Customer's estimate ${quantityInput(line.estimate)} kg (not billed).` : undefined;

  return (
    <li className="flex flex-col gap-component rounded-lg border border-border p-card">
      <div className="flex items-start justify-between gap-component">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="type-label break-words text-foreground">{line.name}</span>
            {added && <Badge variant="info">Added</Badge>}
          </span>
          <span className="type-caption text-muted-foreground">
            {price}
            {added ? " (today's price)" : ""}
          </span>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${line.name}`}>
          <Trash2Icon aria-hidden />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-form xs:grid-cols-2">
        <FormField id={`${idPrefix}-quantity`} label={weighed ? "Weight (kg)" : "Quantity"} hint={hint} error={error}>
          <Input
            id={`${idPrefix}-quantity`}
            value={line.quantity}
            onChange={(event) => onChange({ quantity: event.target.value })}
            inputMode={weighed ? "decimal" : "numeric"}
            autoComplete="off"
            maxLength={7}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(`${idPrefix}-quantity`, hint, error)}
          />
        </FormField>
      </div>
      <div className="flex items-center justify-between gap-component">
        {weighed && line.quantity.trim() === "" ? <Badge variant="warning">Not weighed yet</Badge> : <span />}
        <span className="type-label text-foreground" aria-label={`${line.name} line total`}>
          {lineTotal === null ? "—" : formatNaira(lineTotal)}
        </span>
      </div>
    </li>
  );
}
