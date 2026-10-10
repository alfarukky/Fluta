"use client";

import { SearchIcon, UserPlusIcon, UserRoundIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { findCustomerByPhone, searchCustomers } from "@/actions/orders";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CUSTOMER_NAME_MAX } from "@/schemas/orders";
import type { CustomerMatch } from "@/types/orders";

import type { OrderDraft } from "./order-draft";
import { OrderSection } from "./OrderSection";

interface CustomerSectionProps {
  draft: OrderDraft;
  onChange: (change: Partial<OrderDraft>) => void;
  errors: Record<string, string>;
}

const SEARCH_DELAY_MS = 300;

export function CustomerSection({ draft, onChange, errors }: CustomerSectionProps) {
  const id = useId();
  const fieldId = (name: string) => `${id}-${name}`;

  return (
    <OrderSection title="Customer" description="Search by phone number or name, or add a new customer.">
      {draft.customerMode === "existing" ? (
        draft.selectedCustomer ? (
          <SelectedCustomer
            customer={draft.selectedCustomer}
            onChange={() => onChange({ selectedCustomer: null })}
          />
        ) : (
          <CustomerSearch
            inputId={fieldId("search")}
            error={errors.customer ?? errors["customer.customerId"]}
            onSelect={(customer) => onChange({ selectedCustomer: customer })}
            onAddNew={() => onChange({ customerMode: "new" })}
          />
        )
      ) : (
        <NewCustomerFields draft={draft} onChange={onChange} errors={errors} fieldId={fieldId} />
      )}
    </OrderSection>
  );
}

function SelectedCustomer({ customer, onChange }: { customer: CustomerMatch; onChange: () => void }) {
  return (
    <div className="flex flex-col gap-component rounded-lg border border-border p-card xs:flex-row xs:items-center xs:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <UserRoundIcon className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="type-label truncate text-foreground">{customer.name}</span>
          <span className="type-body-sm text-muted-foreground">{customer.phone}</span>
          {customer.email && <span className="type-caption truncate text-muted-foreground">{customer.email}</span>}
        </div>
      </div>
      <Button type="button" variant="outline" onClick={onChange}>
        Change customer
      </Button>
    </div>
  );
}

interface CustomerSearchProps {
  inputId: string;
  error?: string;
  onSelect: (customer: CustomerMatch) => void;
  onAddNew: () => void;
}

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; query: string; customers: CustomerMatch[] }
  | { status: "error"; message: string };

function CustomerSearch({ inputId, error, onSelect, onAddNew }: CustomerSearchProps) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const text = query.trim();

  useEffect(() => {
    if (text.length < 2) return;
    let current = true;
    const timer = setTimeout(async () => {
      setSearch({ status: "searching" });
      const result = await searchCustomers(text);
      if (!current) return;
      setSearch(result.ok ? { status: "done", query: text, customers: result.customers } : { status: "error", message: result.message });
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text]);

  const hint = "At least 2 characters, like 0803 or Amaka.";
  const shown = text.length >= 2 ? search : { status: "idle" as const };

  return (
    <div className="flex flex-col gap-component">
      <FormField id={inputId} label="Find a customer" hint={hint} error={error}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-10"
            autoComplete="off"
            maxLength={80}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(inputId, hint, error)}
          />
        </div>
      </FormField>

      <div aria-live="polite" className="flex flex-col gap-2">
        {shown.status === "searching" && <p className="type-body-sm text-muted-foreground">Searching…</p>}
        {shown.status === "error" && <p className="type-body-sm text-error">{shown.message}</p>}
        {shown.status === "done" && shown.customers.length === 0 && (
          <p className="type-body-sm text-muted-foreground">No customers match “{shown.query}”.</p>
        )}
        {shown.status === "done" && shown.customers.length > 0 && (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border" aria-label="Matching customers">
            {shown.customers.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => onSelect(customer)}
                  className="flex min-h-11 w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="type-label text-foreground">{customer.name}</span>
                  <span className="type-body-sm text-muted-foreground">{customer.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button type="button" variant="outline" onClick={onAddNew} className="self-start">
        <UserPlusIcon data-icon="inline-start" aria-hidden />
        Add a new customer
      </Button>
    </div>
  );
}

interface NewCustomerFieldsProps extends CustomerSectionProps {
  fieldId: (name: string) => string;
}

// A phone number that already belongs to one of the store's customers uses
// that customer, shown by their saved name (which is never overwritten).
function NewCustomerFields({ draft, onChange, errors, fieldId }: NewCustomerFieldsProps) {
  const { name, phone, email } = draft.newCustomer;
  const [lookupError, setLookupError] = useState<string | null>(null);

  function update(change: Partial<OrderDraft["newCustomer"]>) {
    onChange({ newCustomer: { ...draft.newCustomer, ...change }, ...("phone" in change ? { phoneMatch: null } : {}) });
  }

  async function checkPhone() {
    if (!phone.trim()) return;
    const result = await findCustomerByPhone(phone);
    if (!result.ok) {
      setLookupError(result.message);
      return;
    }
    setLookupError(null);
    onChange({ phoneMatch: result.customer });
  }

  const phoneHint = "Numbers without a country code are Nigerian.";
  const nameError = errors["customer.name"];
  const phoneError = errors["customer.phone"] ?? errors.customer;
  const emailError = errors["customer.email"];

  return (
    <div className="flex flex-col gap-form">
      <FormField id={fieldId("phone")} label="Phone number" hint={phoneHint} error={phoneError}>
        <Input
          id={fieldId("phone")}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          maxLength={40}
          onChange={(event) => update({ phone: event.target.value })}
          onBlur={checkPhone}
          aria-invalid={phoneError ? true : undefined}
          aria-describedby={describedBy(fieldId("phone"), phoneHint, phoneError)}
        />
      </FormField>
      {lookupError && <p className="type-caption text-error">{lookupError}</p>}

      {draft.phoneMatch ? (
        <div className="flex flex-col gap-component rounded-lg border border-info/40 bg-info/12 p-card" role="status">
          <p className="type-body-sm text-foreground">
            This number belongs to <span className="font-semibold">{draft.phoneMatch.name}</span>. The order will be
            for them, and their saved name stays as it is.
          </p>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => onChange({ customerMode: "existing", selectedCustomer: draft.phoneMatch, phoneMatch: null })}
          >
            Use {draft.phoneMatch.name}
          </Button>
        </div>
      ) : (
        <>
          <FormField id={fieldId("name")} label="Name" error={nameError}>
            <Input
              id={fieldId("name")}
              autoComplete="off"
              value={name}
              maxLength={CUSTOMER_NAME_MAX}
              onChange={(event) => update({ name: event.target.value })}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={describedBy(fieldId("name"), undefined, nameError)}
            />
          </FormField>
          <FormField id={fieldId("email")} label="Email (optional)" error={emailError}>
            <Input
              id={fieldId("email")}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              maxLength={254}
              onChange={(event) => update({ email: event.target.value })}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={describedBy(fieldId("email"), undefined, emailError)}
            />
          </FormField>
        </>
      )}

      <Button
        type="button"
        variant="ghost"
        className="self-start"
        onClick={() => onChange({ customerMode: "existing", phoneMatch: null })}
      >
        Search existing customers instead
      </Button>
    </div>
  );
}
