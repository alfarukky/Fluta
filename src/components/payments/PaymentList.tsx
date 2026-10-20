"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { loadMorePayments } from "@/actions/payments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAYMENT_METHOD_LABELS } from "@/lib/orders";
import { PAYMENT_SOURCE_LABELS } from "@/lib/payments";
import { cn } from "@/lib/utils";
import type { PaymentListFilters } from "@/schemas/payments";
import type { PaymentListRow } from "@/types/payments";

interface PaymentListProps {
  filters: PaymentListFilters;
  initialRows: PaymentListRow[];
  initialCursor: string | null;
}

// The store's payments: a table on desktop, stacked cards below. More rows
// load when "Load more" scrolls into view, or when it is tapped.
export function PaymentList({ filters, initialRows, initialCursor }: PaymentListProps) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  function loadMore() {
    if (!cursor || pending) return;
    startTransition(async () => {
      const result = await loadMorePayments(filters, cursor);
      if (!result.ok) {
        setFailed(true);
        toast.error(result.message);
        return;
      }
      setFailed(false);
      setRows((current) => [...current, ...result.rows]);
      setCursor(result.nextCursor);
    });
  }

  // Load the next page as the button comes into view, unless the last try
  // failed (then the button waits for a tap, so errors don't repeat).
  const loadMoreOnView = useEffectEvent(loadMore);
  useEffect(() => {
    const button = loadMoreRef.current;
    if (!button || failed || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreOnView();
    });
    observer.observe(button);
    return () => observer.disconnect();
  }, [cursor, failed]);

  return (
    <section aria-label="Payments" className="flex flex-col gap-component">
      <ul className="flex flex-col gap-component lg:hidden">
        {rows.map((row) => (
          <PaymentCard key={row.id} row={row} />
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card lg:block">
        <PaymentTable rows={rows} />
      </div>

      {cursor && (
        <Button ref={loadMoreRef} variant="outline" onClick={loadMore} disabled={pending} className="self-center">
          {pending ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}

function StatusBadge({ voided }: { voided: boolean }) {
  return voided ? <Badge variant="neutral">Voided</Badge> : <Badge variant="success">Confirmed</Badge>;
}

function PaymentTable({ rows }: { rows: PaymentListRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-card">Received</TableHead>
          <TableHead>Order</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Recorded by</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="pr-card text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="relative">
            <TableCell className={cn("type-body-sm pl-card align-top whitespace-normal", row.voided && "line-through")}>
              {row.confirmed}
            </TableCell>
            <TableCell className="min-w-40 align-top whitespace-normal">
              <div className="flex min-w-0 flex-col">
                {/* The link covers the whole row, so any part of it opens the order. */}
                <Link
                  href={`/orders/${row.orderId}`}
                  className="type-label text-foreground outline-none after:absolute after:inset-0 focus-visible:underline"
                >
                  {row.displayNumber}
                </Link>
                <span className="type-body-sm break-words text-muted-foreground">{row.customerName}</span>
              </div>
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              <div className="flex flex-col">
                <span className="type-body-sm text-foreground">{PAYMENT_METHOD_LABELS[row.method]}</span>
                <span className="type-caption text-muted-foreground">{PAYMENT_SOURCE_LABELS[row.source]}</span>
              </div>
            </TableCell>
            <TableCell className="type-body-sm align-top break-words whitespace-normal">{row.recordedBy}</TableCell>
            <TableCell className="align-top whitespace-normal">
              <StatusBadge voided={row.voided} />
            </TableCell>
            <TableCell className={cn("type-label pr-card text-right align-top", row.voided && "line-through")}>
              {row.amount}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PaymentCard({ row }: { row: PaymentListRow }) {
  return (
    <li className="relative flex flex-col gap-3 rounded-xl border border-border bg-card p-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/orders/${row.orderId}`}
            className="type-h3 text-foreground outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          >
            {row.displayNumber}
          </Link>
          <span className="type-body-sm break-words text-foreground">{row.customerName}</span>
          <span className={cn("type-caption text-muted-foreground", row.voided && "line-through")}>{row.confirmed}</span>
        </div>
        <span className={cn("type-label shrink-0 text-right text-foreground", row.voided && "line-through")}>
          {row.amount}
        </span>
      </div>
      <p className="type-body-sm break-words text-muted-foreground">
        {PAYMENT_METHOD_LABELS[row.method]} · {PAYMENT_SOURCE_LABELS[row.source]} · {row.recordedBy}
      </p>
      <div>
        <StatusBadge voided={row.voided} />
      </div>
    </li>
  );
}
