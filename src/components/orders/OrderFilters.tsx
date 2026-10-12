"use client";

import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { OrderStage, FulfilmentType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FULFILMENT_TYPE_LABELS, ORDER_STAGE_LABELS, PAYMENT_STATE_LABELS, PAYMENT_STATES } from "@/lib/orders";
import {
  ORDER_DATE_RANGE_LABELS,
  ORDER_DATE_RANGES,
  ORDER_SEARCH_MAX,
  toOrderListSearch,
  type OrderListFilters,
} from "@/schemas/orders";

// Select items can't have an empty value, so "any" stands for no filter.
const ANY = "any";

interface OrderFiltersProps {
  filters: OrderListFilters;
}

// Search and filters live in the page address, so back, refresh, and shared
// links keep them. Each change is a new history entry.
export function OrderFilters({ filters }: OrderFiltersProps) {
  const router = useRouter();
  const [query, setQuery] = useState(filters.q);

  function apply(next: OrderListFilters) {
    router.push(`/orders${toOrderListSearch(next)}`, { scroll: false });
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply({ ...filters, q: query.trim() });
  }

  return (
    <section aria-label="Search and filter orders" className="flex flex-col gap-component">
      <form role="search" onSubmit={search} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            value={query}
            maxLength={ORDER_SEARCH_MAX}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Number, phone, or name"
            aria-label="Search orders by order number, customer phone, or name"
            className="pl-10"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <div className="grid grid-cols-1 gap-2 xs:grid-cols-2 xl:grid-cols-4">
        <FilterSelect
          label="Stage"
          value={filters.stage}
          options={Object.values(OrderStage).map((stage) => ({ value: stage, label: ORDER_STAGE_LABELS[stage] }))}
          anyLabel="All stages"
          onChange={(stage) => apply({ ...filters, stage })}
        />
        <FilterSelect
          label="Payment"
          value={filters.payment}
          options={PAYMENT_STATES.map((state) => ({ value: state, label: PAYMENT_STATE_LABELS[state] }))}
          anyLabel="All payments"
          onChange={(payment) => apply({ ...filters, payment })}
        />
        <FilterSelect
          label="Fulfilment"
          value={filters.type}
          options={Object.values(FulfilmentType).map((type) => ({ value: type, label: FULFILMENT_TYPE_LABELS[type] }))}
          anyLabel="All fulfilment types"
          onChange={(type) => apply({ ...filters, type })}
        />
        <Select
          value={filters.created}
          onValueChange={(created) => apply({ ...filters, created: created as OrderListFilters["created"] })}
        >
          <SelectTrigger aria-label="Created date" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {ORDER_DATE_RANGES.map((range) => (
              <SelectItem key={range} value={range}>
                {range === "all" ? "All dates" : ORDER_DATE_RANGE_LABELS[range]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
    <Select value={value ?? ANY} onValueChange={(next) => onChange(next === ANY ? null : (next as T))}>
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
