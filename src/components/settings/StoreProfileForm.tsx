"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { saveStoreProfile, type ProfileFormValues } from "@/actions/store-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { describedBy, FormField } from "./FormField";

interface StoreProfileFormProps {
  initialValues: ProfileFormValues;
  slug: string;
  // "fluta.app/store/" shown before the read-only slug.
  linkPrefix: string;
  // Shown between the fields and the buttons (the customer booking card).
  children?: ReactNode;
}

const HINTS = {
  name: "The name customers see when booking laundry services.",
  slug: "Contact Fluta to change your link.",
  description: "A short introduction for your booking page. Plain text, up to 300 characters.",
  address: "Shown to customers and on receipts.",
  phone: "Numbers without a country code are read as Nigerian.",
  email: "For customers to contact you. Not used to sign in.",
};

export function StoreProfileForm({ initialValues, slug, linkPrefix, children }: StoreProfileFormProps) {
  const [saved, setSaved] = useState(initialValues);
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const dirty = (Object.keys(values) as (keyof ProfileFormValues)[]).some((key) => values[key] !== saved[key]);

  function change(field: keyof ProfileFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function cancel() {
    setValues(saved);
    setErrors({});
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveStoreProfile(formData);
      if (result.ok) {
        setSaved(result.values);
        setValues(result.values);
        setErrors({});
        toast.success(result.message);
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
      }
    });
  }

  const field = (name: keyof ProfileFormValues) => ({
    id: `store-${name}`,
    name,
    value: values[name],
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": describedBy(`store-${name}`, HINTS[name], errors[name]),
    onChange: (event: { target: { value: string } }) => change(name, event.target.value),
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-grid" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Store information</CardTitle>
          <CardDescription>The basics customers will see when they book with you.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-form">
          <FormField id="store-name" label="Store name" hint={HINTS.name} error={errors.name}>
            <Input {...field("name")} required minLength={2} maxLength={80} autoComplete="organization" />
          </FormField>

          <FormField id="store-slug" label="Store link" hint={HINTS.slug}>
            <div className="flex h-11 min-w-0 items-stretch overflow-hidden rounded-lg border border-input bg-muted">
              <span className="type-body-sm hidden items-center border-r border-input px-3 text-muted-foreground xs:flex">
                {linkPrefix}
              </span>
              <input
                id="store-slug"
                value={slug}
                readOnly
                aria-describedby="store-slug-hint"
                className="type-body-sm min-w-0 flex-1 bg-transparent px-3 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </FormField>

          <FormField id="store-description" label="Description" hint={HINTS.description} error={errors.description}>
            <Textarea {...field("description")} maxLength={300} rows={3} />
          </FormField>

          <FormField id="store-address" label="Address" hint={HINTS.address} error={errors.address}>
            <Input {...field("address")} maxLength={200} autoComplete="street-address" />
          </FormField>

          <div className="grid gap-form md:grid-cols-2">
            <FormField id="store-phone" label="Phone" hint={HINTS.phone} error={errors.phone}>
              <Input {...field("phone")} type="tel" inputMode="tel" maxLength={40} autoComplete="tel" />
            </FormField>
            <FormField id="store-email" label="Email" hint={HINTS.email} error={errors.email}>
              <Input {...field("email")} type="email" maxLength={254} autoComplete="email" />
            </FormField>
          </div>
        </CardContent>
      </Card>

      {children}

      <div className="flex flex-col-reverse gap-component xs:flex-row xs:justify-end">
        <Button type="button" variant="ghost" onClick={cancel} disabled={!dirty || pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
