"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { saveDefaultDeliveryFee, type DefaultFeeActionResult } from "@/actions/fulfilment";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { InputWithPrefix } from "@/components/ui/input-with-prefix";
import { formatAreaCharge, formatNairaInput, parseNairaToKobo } from "@/lib/money";
import { DEFAULT_FEE_HINT } from "@/schemas/fulfilment";

interface DefaultFeeFormProps {
  // Kobo, or null for no default fee.
  defaultDeliveryFee: number | null;
  onSaved: (result: Extract<DefaultFeeActionResult, { ok: true }>) => void;
}

function toInput(fee: number | null): string {
  return fee === null ? "" : formatNairaInput(fee);
}

// The optional fee for customers whose area isn't listed. Empty means no
// default fee. ₦0 is a set fee ("Free"). A single field, so errors show
// beneath it without scrolling.
export function DefaultFeeForm({ defaultDeliveryFee, onSaved }: DefaultFeeFormProps) {
  const id = useId();
  const fieldId = `${id}-default-fee`;
  const [saved, setSaved] = useState(() => toInput(defaultDeliveryFee));
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const text = value.trim();
  const kobo = text ? parseNairaToKobo(text) : null;
  const preview = kobo === null ? null : `My area isn't listed: ${formatAreaCharge({ chargeType: "FIXED", fixedCharge: kobo })}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("defaultDeliveryFee", value);
    startTransition(async () => {
      const result = await saveDefaultDeliveryFee(formData);
      if (result.ok) {
        const next = toInput(result.fee.defaultDeliveryFee);
        setSaved(next);
        setValue(next);
        setError(undefined);
        toast.success(result.message, { description: "Existing orders keep their charge." });
        onSaved(result);
      } else {
        setError(result.fieldErrors?.defaultDeliveryFee);
        toast.error(result.message);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-component rounded-lg border border-border p-3" noValidate>
      <FormField id={fieldId} label="Default pickup & delivery fee" hint={DEFAULT_FEE_HINT} error={error}>
        <div className="flex flex-col gap-component xs:flex-row xs:items-start">
          <InputWithPrefix
            id={fieldId}
            prefix="₦"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="No default fee"
            maxLength={20}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(fieldId, DEFAULT_FEE_HINT, error)}
          />
          <Button type="submit" variant="outline" disabled={pending || value === saved} className="shrink-0">
            {pending ? "Saving…" : "Save fee"}
          </Button>
        </div>
      </FormField>
      {preview && (
        <p className="type-caption text-muted-foreground" aria-live="polite">
          Customers see: <span className="font-medium text-foreground">{preview}</span>
        </p>
      )}
    </form>
  );
}
