"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { createServiceArea, updateServiceArea, type AreaActionResult } from "@/actions/fulfilment";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputWithPrefix } from "@/components/ui/input-with-prefix";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AreaChargeType } from "@/generated/prisma/enums";
import { formatAreaCharge, formatNairaInput, parseNairaToKobo } from "@/lib/money";
import { AREA_CHARGE_TYPE_LABELS, AREA_NAME_MAX } from "@/schemas/fulfilment";
import type { FulfilmentArea } from "@/types/fulfilment";

type SavedArea = Extract<AreaActionResult, { ok: true }>;

interface AreaSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The area being edited, or null to add one.
  area: FulfilmentArea | null;
  // Changes each time the drawer opens, so the form starts afresh.
  formKey: number;
  onSaved: (result: SavedArea) => void;
  // Disable or enable the area being edited (the drawer then closes).
  onToggleActive: (area: FulfilmentArea) => void;
  toggling: boolean;
}

// The add/edit drawer. The form is remounted each time it opens (formKey), so
// it always starts from the area's saved values.
export function AreaSheet({ open, onOpenChange, area, formKey, ...formProps }: AreaSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-y-auto bg-card data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <AreaForm key={formKey} area={area} onCancel={() => onOpenChange(false)} {...formProps} />
      </SheetContent>
    </Sheet>
  );
}

interface FormValues {
  name: string;
  chargeType: AreaChargeType;
  fixedCharge: string;
}

const CHARGE_TYPES = Object.values(AreaChargeType);

const CHARGE_HINTS: Record<AreaChargeType, string> = {
  FIXED: "Customers see the charge before they book. Enter 0 for free.",
  QUOTE_REQUIRED: "Staff set the charge after checking the address.",
};

function initialValues(area: FulfilmentArea | null): FormValues {
  if (!area) return { name: "", chargeType: "FIXED", fixedCharge: "" };
  return {
    name: area.name,
    chargeType: area.chargeType,
    fixedCharge: area.fixedCharge === null ? "" : formatNairaInput(area.fixedCharge),
  };
}

interface AreaFormProps extends Omit<AreaSheetProps, "open" | "onOpenChange" | "formKey"> {
  onCancel: () => void;
}

function AreaForm({ area, onSaved, onToggleActive, toggling, onCancel }: AreaFormProps) {
  const id = useId();
  const [values, setValues] = useState(() => initialValues(area));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const fixed = values.chargeType === AreaChargeType.FIXED;
  const kobo = fixed ? parseNairaToKobo(values.fixedCharge) : null;
  const preview = fixed
    ? kobo === null
      ? null
      : formatAreaCharge({ chargeType: "FIXED", fixedCharge: kobo })
    : formatAreaCharge({ chargeType: "QUOTE_REQUIRED", fixedCharge: null });

  function changeChargeType(value: string) {
    const chargeType = CHARGE_TYPES.find((type) => type === value);
    if (chargeType) setValues((current) => ({ ...current, chargeType }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("name", values.name);
    formData.set("chargeType", values.chargeType);
    // A quote-required area has no charge, whatever was typed before switching.
    formData.set("fixedCharge", fixed ? values.fixedCharge : "");

    startTransition(async () => {
      const result = area ? await updateServiceArea(area.id, formData) : await createServiceArea(formData);
      if (result.ok) {
        toast.success(`${result.message}: ${result.area.name}, ${formatAreaCharge(result.area)}`);
        onSaved(result);
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
      }
    });
  }

  const fieldId = (name: string) => `${id}-${name}`;
  const nameHint = "The name customers choose when they book, like Karu or Wuse 2.";
  const chargeHint = "One charge per order, covering pickup and return delivery.";

  return (
    <form onSubmit={submit} className="flex min-h-full flex-col" noValidate>
      <SheetHeader className="border-b border-border p-card pr-14">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="type-h3">{area ? "Edit area" : "Add area"}</SheetTitle>
          {area && !area.isActive && <Badge variant="neutral">Inactive</Badge>}
        </div>
        <SheetDescription className="type-body-sm">
          {area
            ? "Changes apply to new orders only. Existing orders keep their area and charge."
            : "An area you pick up from and deliver to."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-form p-card">
        <FormField id={fieldId("name")} label="Area name" hint={nameHint} error={errors.name}>
          <Input
            id={fieldId("name")}
            value={values.name}
            onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
            required
            minLength={2}
            maxLength={AREA_NAME_MAX}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy(fieldId("name"), nameHint, errors.name)}
          />
        </FormField>

        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={errors.chargeType ? fieldId("charge-type-error") : undefined}
        >
          <legend className="type-label mb-1 text-foreground">Pickup & delivery charge</legend>
          <p className="type-caption mb-1 text-muted-foreground">{chargeHint}</p>
          <RadioGroup value={values.chargeType} onValueChange={changeChargeType} className="gap-2">
            {CHARGE_TYPES.map((type) => (
              <Label
                key={type}
                htmlFor={fieldId(type)}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-data-checked:border-primary has-data-checked:bg-accent/40"
              >
                <RadioGroupItem id={fieldId(type)} value={type} className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="type-label text-foreground">{AREA_CHARGE_TYPE_LABELS[type]}</span>
                  <span className="type-caption font-normal text-muted-foreground">{CHARGE_HINTS[type]}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          {errors.chargeType && (
            <p id={fieldId("charge-type-error")} className="type-caption text-error">
              {errors.chargeType}
            </p>
          )}
        </fieldset>

        {fixed && (
          <FormField id={fieldId("charge")} label="Charge" error={errors.fixedCharge}>
            <InputWithPrefix
              id={fieldId("charge")}
              prefix="₦"
              value={values.fixedCharge}
              onChange={(event) => setValues((current) => ({ ...current, fixedCharge: event.target.value }))}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              maxLength={20}
              aria-invalid={errors.fixedCharge ? true : undefined}
              aria-describedby={describedBy(fieldId("charge"), undefined, errors.fixedCharge)}
            />
          </FormField>
        )}
        {!fixed && errors.fixedCharge && <p className="type-caption text-error">{errors.fixedCharge}</p>}

        {preview && (
          <p className="type-caption text-muted-foreground" aria-live="polite">
            Customers see: <span className="font-medium text-foreground">{preview}</span>
          </p>
        )}
      </div>

      <SheetFooter className="border-t border-border p-card">
        <div className="flex flex-col-reverse gap-component xs:flex-row xs:items-center">
          {area && (
            <Button
              type="button"
              variant="outline"
              onClick={() => onToggleActive(area)}
              disabled={pending || toggling}
              className="xs:mr-auto"
            >
              {area.isActive ? "Disable area" : "Enable area"}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending} className={area ? "" : "xs:ml-auto"}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : area ? "Save changes" : "Add area"}
          </Button>
        </div>
      </SheetFooter>
    </form>
  );
}
