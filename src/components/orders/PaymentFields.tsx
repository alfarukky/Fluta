"use client";

import { TriangleAlertIcon } from "lucide-react";

import { describedBy, FormField } from "@/components/settings/FormField";
import { Input } from "@/components/ui/input";
import { InputWithPrefix } from "@/components/ui/input-with-prefix";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_METHOD_LABELS } from "@/lib/orders";
import { STORE_PAYMENT_METHODS, type StorePaymentMethod } from "@/lib/payments";
import { PAYMENT_NOTE_MAX, PAYMENT_REFERENCE_MAX, paymentDetailsSchema } from "@/schemas/payments";
import { refundDetailsSchema } from "@/schemas/refunds";

// The amount, method, reference, and note of a store-collected payment or a
// refund: the Record payment and Record refund forms, and the correct one
// recorded when voiding a mistaken one.

export interface PaymentDraft {
  amount: string;
  method: StorePaymentMethod | "";
  reference: string;
  note: string;
}

export type PaymentField = keyof PaymentDraft;
export type PaymentFieldErrors = Partial<Record<PaymentField | "reason", string>>;

type DetailsSchema = typeof paymentDetailsSchema | typeof refundDetailsSchema;

// The browser's check before sending, with the server's own rules. The
// server checks everything again.
export function checkPaymentDraft(
  draft: PaymentDraft,
  schema: DetailsSchema = paymentDetailsSchema,
): { ok: true; amountKobo: number } | { ok: false; errors: PaymentFieldErrors } {
  const parsed = schema.safeParse(draft);
  if (parsed.success) return { ok: true, amountKobo: parsed.data.amount };
  const errors: PaymentFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === "amount" || field === "method" || field === "reference" || field === "note") && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return { ok: false, errors };
}

interface PaymentFieldsProps {
  idPrefix: string;
  draft: PaymentDraft;
  errors: PaymentFieldErrors;
  amountHint?: string;
  // Refunds: "How it was paid back", and a required note.
  methodLabel?: string;
  noteHint?: string;
  notePlaceholder?: string;
  disabled: boolean;
  onChange: (field: PaymentField, value: string) => void;
}

export function PaymentFields({
  idPrefix,
  draft,
  errors,
  amountHint,
  methodLabel = "Method",
  noteHint = "Optional. Staff only.",
  notePlaceholder,
  disabled,
  onChange,
}: PaymentFieldsProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const referenceHint = "Optional. For example a transfer or POS reference.";

  return (
    <>
      <FormField id={id("amount")} label="Amount" hint={amountHint} error={errors.amount}>
        <InputWithPrefix
          id={id("amount")}
          prefix="₦"
          value={draft.amount}
          onChange={(event) => onChange("amount", event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          maxLength={20}
          disabled={disabled}
          aria-invalid={errors.amount ? true : undefined}
          aria-describedby={describedBy(id("amount"), amountHint, errors.amount)}
        />
      </FormField>

      <fieldset className="flex flex-col gap-2" data-form-field>
        <legend className="type-label mb-2 text-foreground">{methodLabel}</legend>
        <RadioGroup
          value={draft.method}
          onValueChange={(value) => onChange("method", value)}
          className="grid grid-cols-2 gap-2"
          disabled={disabled}
          aria-invalid={errors.method ? true : undefined}
          aria-describedby={errors.method ? id("method-error") : undefined}
        >
          {STORE_PAYMENT_METHODS.map((method) => (
            <Label
              key={method}
              htmlFor={id(method)}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 has-data-checked:border-primary has-data-checked:bg-accent/40"
            >
              <RadioGroupItem id={id(method)} value={method} />
              <span className="type-label text-foreground">{PAYMENT_METHOD_LABELS[method]}</span>
            </Label>
          ))}
        </RadioGroup>
        {errors.method && (
          <p id={id("method-error")} className="type-caption text-error">
            {errors.method}
          </p>
        )}
      </fieldset>

      <FormField id={id("reference")} label="Reference" hint={referenceHint} error={errors.reference}>
        <Input
          id={id("reference")}
          value={draft.reference}
          onChange={(event) => onChange("reference", event.target.value)}
          maxLength={PAYMENT_REFERENCE_MAX}
          autoComplete="off"
          disabled={disabled}
          aria-invalid={errors.reference ? true : undefined}
          aria-describedby={describedBy(id("reference"), referenceHint, errors.reference)}
        />
      </FormField>

      <FormField id={id("note")} label="Note" hint={noteHint} error={errors.note}>
        <Textarea
          id={id("note")}
          value={draft.note}
          onChange={(event) => onChange("note", event.target.value)}
          maxLength={PAYMENT_NOTE_MAX}
          rows={2}
          placeholder={notePlaceholder}
          disabled={disabled}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={describedBy(id("note"), noteHint, errors.note)}
        />
      </FormField>
    </>
  );
}

// The question staff answer before an overpayment is recorded.
export function OverpaymentNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="flex gap-2.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p className="type-body-sm text-foreground">{message}</p>
    </div>
  );
}
