"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { createService, updateService } from "@/actions/services";
import { FormField, describedBy } from "@/components/settings/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputWithPrefix } from "@/components/ui/input-with-prefix";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { PricingType } from "@/generated/prisma/enums";
import { formatNairaInput, formatServicePrice, parseNairaToKobo } from "@/lib/money";
import { PRICING_TYPE_LABELS, SERVICE_CATEGORY_MAX, SERVICE_NAME_MAX } from "@/schemas/services";
import type { CatalogueService } from "@/types/services";

interface ServiceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The service being edited, or null to add one.
  service: CatalogueService | null;
  // Changes each time the drawer opens, so the form starts afresh.
  formKey: number;
  categories: string[];
  onSaved: (service: CatalogueService) => void;
  // Disable or enable the service being edited (the drawer then closes).
  onToggleActive: (service: CatalogueService) => void;
  toggling: boolean;
}

// The add/edit drawer. The form is remounted each time it opens (formKey), so
// it always starts from the service's saved values, and stays mounted while
// the drawer animates closed.
export function ServiceSheet({ open, onOpenChange, service, formKey, ...formProps }: ServiceSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-y-auto bg-card data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <ServiceForm key={formKey} service={service} onCancel={() => onOpenChange(false)} {...formProps} />
      </SheetContent>
    </Sheet>
  );
}

interface FormValues {
  name: string;
  category: string;
  pricingType: PricingType;
  price: string;
  requiresQuote: boolean;
}

const PRICING_TYPES = Object.values(PricingType);

const PRICING_HINTS: Record<PricingType, string> = {
  PER_ITEM: "Each piece, like a shirt or a dress.",
  PER_KG: "Weighed at the store. Always requires a quote.",
  PER_PACKAGE: "A fixed bundle, like a bedding set.",
};

function initialValues(service: CatalogueService | null): FormValues {
  if (!service) return { name: "", category: "", pricingType: "PER_ITEM", price: "", requiresQuote: false };
  return {
    name: service.name,
    category: service.category ?? "",
    pricingType: service.pricingType,
    price: formatNairaInput(service.price),
    requiresQuote: service.requiresQuote,
  };
}

interface ServiceFormProps extends Omit<ServiceSheetProps, "open" | "onOpenChange" | "formKey"> {
  onCancel: () => void;
}

function ServiceForm({ service, categories, onSaved, onToggleActive, toggling, onCancel }: ServiceFormProps) {
  const id = useId();
  const [values, setValues] = useState(() => initialValues(service));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const perKg = values.pricingType === PricingType.PER_KG;
  const requiresQuote = perKg || values.requiresQuote;
  const kobo = parseNairaToKobo(values.price);
  const preview = kobo === null ? null : formatServicePrice({ price: kobo, pricingType: values.pricingType, requiresQuote });

  function change<Field extends keyof FormValues>(field: Field, value: FormValues[Field]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  // Per kg turns quote required on (and locks it); switching away leaves it on
  // but editable.
  function changePricingType(value: string) {
    const pricingType = PRICING_TYPES.find((type) => type === value);
    if (!pricingType) return;
    setValues((current) => ({
      ...current,
      pricingType,
      requiresQuote: pricingType === PricingType.PER_KG || current.requiresQuote,
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("name", values.name);
    formData.set("category", values.category);
    formData.set("pricingType", values.pricingType);
    formData.set("price", values.price);
    formData.set("requiresQuote", requiresQuote ? "on" : "");

    startTransition(async () => {
      const result = service ? await updateService(service.id, formData) : await createService(formData);
      if (result.ok) {
        toast.success(`${result.message}: ${result.service.name}, ${formatServicePrice(result.service)}`);
        onSaved(result.service);
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
      }
    });
  }

  const fieldId = (name: string) => `${id}-${name}`;
  const hints = {
    name: "As customers and staff will see it.",
    category: "Optional. Groups services, like Wash & iron.",
    price: requiresQuote
      ? "The starting price, confirmed after inspection. Enter 0 to show “Price on inspection”."
      : `The price ${PRICING_TYPE_LABELS[values.pricingType].toLowerCase()}.`,
    requiresQuote: perKg
      ? "Per-kg services are weighed at the store, so they always require a quote."
      : "Staff confirm the final price after inspecting the clothes.",
  };

  return (
    <form onSubmit={submit} className="flex min-h-full flex-col" noValidate>
      <SheetHeader className="border-b border-border p-card pr-14">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="type-h3">{service ? "Edit service" : "Add service"}</SheetTitle>
          {service && !service.isActive && <Badge variant="neutral">Inactive</Badge>}
        </div>
        <SheetDescription className="type-body-sm">
          {service
            ? "Changes apply to new orders only. Existing orders keep their prices."
            : "Add a service your store offers, with its price."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-form p-card">
        <FormField id={fieldId("name")} label="Service name" hint={hints.name} error={errors.name}>
          <Input
            id={fieldId("name")}
            value={values.name}
            onChange={(event) => change("name", event.target.value)}
            required
            minLength={2}
            maxLength={SERVICE_NAME_MAX}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy(fieldId("name"), hints.name, errors.name)}
          />
        </FormField>

        <FormField id={fieldId("category")} label="Category" hint={hints.category} error={errors.category}>
          <Input
            id={fieldId("category")}
            value={values.category}
            onChange={(event) => change("category", event.target.value)}
            maxLength={SERVICE_CATEGORY_MAX}
            list={fieldId("categories")}
            autoComplete="off"
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={describedBy(fieldId("category"), hints.category, errors.category)}
          />
          <datalist id={fieldId("categories")}>
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </FormField>

        <fieldset className="flex flex-col gap-2" aria-describedby={errors.pricingType ? fieldId("pricing-error") : undefined}>
          <legend className="type-label mb-2 text-foreground">Pricing</legend>
          <RadioGroup value={values.pricingType} onValueChange={changePricingType} className="gap-2">
            {PRICING_TYPES.map((type) => (
              <Label
                key={type}
                htmlFor={fieldId(type)}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-data-checked:border-primary has-data-checked:bg-accent/40"
              >
                <RadioGroupItem id={fieldId(type)} value={type} className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="type-label text-foreground">{PRICING_TYPE_LABELS[type]}</span>
                  <span className="type-caption font-normal text-muted-foreground">{PRICING_HINTS[type]}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          {errors.pricingType && (
            <p id={fieldId("pricing-error")} className="type-caption text-error">
              {errors.pricingType}
            </p>
          )}
        </fieldset>

        <div className="flex items-start justify-between gap-component rounded-lg border border-border p-3">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor={fieldId("quote")} className="type-label text-foreground">
              Quote required
            </Label>
            <p id={fieldId("quote-hint")} className="type-caption text-muted-foreground">
              {hints.requiresQuote}
            </p>
          </div>
          <Switch
            id={fieldId("quote")}
            checked={requiresQuote}
            onCheckedChange={(checked) => change("requiresQuote", checked)}
            disabled={perKg}
            aria-describedby={fieldId("quote-hint")}
            className="mt-1"
          />
        </div>

        <FormField
          id={fieldId("price")}
          label={requiresQuote ? "From price" : "Price"}
          hint={hints.price}
          error={errors.price}
        >
          <InputWithPrefix
            id={fieldId("price")}
            prefix="₦"
            value={values.price}
            onChange={(event) => change("price", event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            maxLength={20}
            aria-invalid={errors.price ? true : undefined}
            aria-describedby={describedBy(fieldId("price"), hints.price, errors.price)}
          />
          {preview && (
            <p className="type-caption text-muted-foreground" aria-live="polite">
              Customers see: <span className="font-medium text-foreground">{preview}</span>
            </p>
          )}
        </FormField>
      </div>

      <SheetFooter className="border-t border-border p-card">
        <div className="flex flex-col-reverse gap-component xs:flex-row xs:items-center">
          {service && (
            <Button
              type="button"
              variant="outline"
              onClick={() => onToggleActive(service)}
              disabled={pending || toggling}
              className="xs:mr-auto"
            >
              {service.isActive ? "Disable service" : "Enable service"}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending} className={service ? "" : "xs:ml-auto"}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : service ? "Save changes" : "Add service"}
          </Button>
        </div>
      </SheetFooter>
    </form>
  );
}
