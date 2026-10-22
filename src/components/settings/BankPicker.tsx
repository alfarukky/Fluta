"use client";

import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface BankChoice {
  id: string;
  name: string;
}

interface BankPickerProps {
  id: string;
  banks: BankChoice[];
  value: string;
  onChange: (bankId: string) => void;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

// Lower case, letters and digits only, single spaces: "U&C  Microfinance" →
// "u c microfinance".
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Banks whose name contains the search, ignoring case and punctuation, or
// whose initials start with it ("gtb" finds Guaranty Trust Bank). An empty
// search keeps every bank.
export function filterBanks<T extends { name: string }>(banks: readonly T[], query: string): T[] {
  const search = normalize(query);
  if (!search) return [...banks];
  const compact = search.replace(/ /g, "");
  return banks.filter((bank) => {
    const name = normalize(bank.name);
    if (name.includes(search)) return true;
    const initials = name
      .split(" ")
      .map((word) => word[0])
      .join("");
    return compact.length >= 2 && initials.startsWith(compact);
  });
}

// A bank select with a search box: Paystack lists a few hundred banks, too
// many to scroll on a phone. The trigger is a combobox button (the field's
// label points at it); the popup has a search field that filters the list
// as you type, with arrow keys and Enter to choose.
export function BankPicker({ id, banks, value, onChange, disabled, ...aria }: BankPickerProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => filterBanks(banks, query), [banks, query]);
  const selected = banks.find((bank) => bank.id === value);

  function changeOpen(next: boolean) {
    setOpen(next);
    setQuery("");
    setActive(Math.max(0, banks.findIndex((bank) => bank.id === value)));
  }

  function choose(bank: BankChoice) {
    onChange(bank.id);
    setOpen(false);
  }

  function moveTo(index: number) {
    const next = Math.min(Math.max(index, 0), matches.length - 1);
    setActive(next);
    listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView?.({ block: "nearest" });
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") moveTo(active + 1);
    else if (event.key === "ArrowUp") moveTo(active - 1);
    else if (event.key === "Home") moveTo(0);
    else if (event.key === "End") moveTo(matches.length - 1);
    else if (event.key === "Enter" && matches[active]) choose(matches[active]);
    else return;
    event.preventDefault();
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-invalid={aria["aria-invalid"]}
          aria-describedby={aria["aria-describedby"]}
          className="flex h-11 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-card py-2 pr-2.5 pl-3.5 text-left text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:hover:bg-input/50"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.name ?? "Choose your bank"}</span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-(--radix-popover-trigger-width) min-w-64 gap-2 p-2"
        onOpenAutoFocus={(event) => {
          // Focus the search field, not the first option.
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              listRef.current?.scrollTo?.({ top: 0 });
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search banks"
            aria-label="Search banks"
            aria-controls={listId}
            aria-activedescendant={matches[active] ? `${listId}-${matches[active].id}` : undefined}
            autoComplete="off"
            className="h-11 w-full rounded-md border border-input bg-card pr-3 pl-9 text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          />
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label="Banks" className="max-h-64 overflow-y-auto overscroll-contain">
          {matches.map((bank, index) => {
            const isSelected = bank.id === value;
            return (
              <li
                key={bank.id}
                id={`${listId}-${bank.id}`}
                role="option"
                aria-selected={isSelected}
                data-index={index}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(bank)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-base md:text-sm",
                  index === active && "bg-muted",
                )}
              >
                <span>{bank.name}</span>
                {isSelected && <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden />}
              </li>
            );
          })}
        </ul>
        {matches.length === 0 && (
          <p role="status" className="px-3 py-2 type-body-sm text-muted-foreground">
            No bank matches &ldquo;{query.trim()}&rdquo;.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
