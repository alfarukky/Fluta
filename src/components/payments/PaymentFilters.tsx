"use client";

import { useRouter } from "next/navigation";

import { PaymentMethod, PaymentSource } from "@/generated/prisma/enums";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAYMENT_METHOD_LABELS } from "@/lib/orders";
import { PAYMENT_SOURCE_LABELS } from "@/lib/payments";
import { cn } from "@/lib/utils";
import {
  PAYMENT_DATE_RANGE_LABELS,
  PAYMENT_DATE_RANGES,
  toPaymentListSearch,
  type PaymentListFilters,
} from "@/schemas/payments";

// Select items can't have an empty value, so "any" stands for no filter.
const ANY = "any";

// Filters live in the page address, so back, refresh, and shared links keep
// them. Each change is a new history entry. The Refunds view has the date
// filter only.
export function PaymentFilters({ filters }: { filters: PaymentListFilters }) {
  const router = useRouter();

  function apply(next: PaymentListFilters) {
    router.push(`/payments${toPaymentListSearch(next)}`, { scroll: false });
  }

  const refunds = filters.view === "refunds";
  return (
    <section
      aria-label={refunds ? "Filter refunds" : "Filter payments"}
      className={cn("grid grid-cols-1 gap-2", !refunds && "xs:grid-cols-3")}
    >
      <Select
        value={filters.date}
        onValueChange={(value) => {
          const date = PAYMENT_DATE_RANGES.find((range) => range === value);
          if (date) apply({ ...filters, date });
        }}
      >
        <SelectTrigger aria-label={refunds ? "Date paid back" : "Date received"} className={cn("w-full", refunds && "xs:max-w-60")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {PAYMENT_DATE_RANGES.map((range) => (
            <SelectItem key={range} value={range}>
              {PAYMENT_DATE_RANGE_LABELS[range]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!refunds && (
        <>
          <FilterSelect
            label="Method"
            value={filters.method}
            options={Object.values(PaymentMethod).map((method) => ({ value: method, label: PAYMENT_METHOD_LABELS[method] }))}
            anyLabel="All methods"
            onChange={(method) => apply({ ...filters, method })}
          />
          <FilterSelect
            label="Source"
            value={filters.source}
            options={Object.values(PaymentSource).map((source) => ({ value: source, label: PAYMENT_SOURCE_LABELS[source] }))}
            anyLabel="All sources"
            onChange={(source) => apply({ ...filters, source })}
          />
        </>
      )}
    </section>
  );
}

interface FilterSelectProps<T extends string> {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  anyLabel: string;
  onChange: (value: T | null) => void;
}

function FilterSelect<T extends string>({ label, value, options, anyLabel, onChange }: FilterSelectProps<T>) {
  return (
    <Select
      value={value ?? ANY}
      onValueChange={(next) => onChange(options.find((option) => option.value === next)?.value ?? null)}
    >
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
