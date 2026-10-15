"use client";

import { describedBy, FormField } from "@/components/settings/FormField";
import { Input } from "@/components/ui/input";
import { CUSTOMER_NAME_MAX } from "@/schemas/field-limits";

import type { BookingDraft, DraftErrors } from "./booking-draft";

interface DetailsStepProps {
  draft: BookingDraft;
  errors: DraftErrors;
  onChange: (patch: Partial<BookingDraft>) => void;
}

const PHONE_HINT = "The store will use it to reach you about this booking.";
const EMAIL_HINT = "Optional. Needed later if you pay online.";

// Name, phone, and email, with the autocomplete names phones fill in. Nothing
// saved about a phone number is ever shown here.
export function DetailsStep({ draft, errors, onChange }: DetailsStepProps) {
  return (
    <div className="flex flex-col gap-form">
      <FormField id="customer-name" label="Your name" error={errors.name}>
        <Input
          id="customer-name"
          name="name"
          autoComplete="name"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          maxLength={CUSTOMER_NAME_MAX}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy("customer-name", undefined, errors.name)}
        />
      </FormField>
      <FormField id="customer-phone" label="Phone number" hint={PHONE_HINT} error={errors.phone}>
        <Input
          id="customer-phone"
          name="tel"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={draft.phone}
          onChange={(event) => onChange({ phone: event.target.value })}
          maxLength={40}
          placeholder="0803 123 4567"
          aria-invalid={errors.phone ? true : undefined}
          aria-describedby={describedBy("customer-phone", PHONE_HINT, errors.phone)}
        />
      </FormField>
      <FormField id="customer-email" label="Email (optional)" hint={EMAIL_HINT} error={errors.email}>
        <Input
          id="customer-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={draft.email}
          onChange={(event) => onChange({ email: event.target.value })}
          maxLength={254}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={describedBy("customer-email", EMAIL_HINT, errors.email)}
        />
      </FormField>
    </div>
  );
}
