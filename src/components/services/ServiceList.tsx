"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatServicePrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PRICING_TYPE_LABELS } from "@/schemas/services";
import type { CatalogueService } from "@/types/services";

interface ServiceListProps {
  services: CatalogueService[];
  // Services with a disable/enable request in flight.
  busyIds: ReadonlySet<string>;
  onEdit: (service: CatalogueService) => void;
  onToggleActive: (service: CatalogueService) => void;
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge variant="success" dot>
      Active
    </Badge>
  ) : (
    <Badge variant="neutral" dot>
      Inactive
    </Badge>
  );
}

function QuoteBadge() {
  return <Badge variant="info">Quote required</Badge>;
}

function ToggleButton({ service, busy, onToggleActive, compact = false }: {
  service: CatalogueService;
  busy: boolean;
  onToggleActive: (service: CatalogueService) => void;
  // Small for table rows; full size (44px) on cards.
  compact?: boolean;
}) {
  return (
    <Button
      // Disable warns on hover; Enable is a plain action.
      variant={service.isActive ? "subtle-destructive" : "subtle"}
      size={compact ? "sm" : "default"}
      onClick={() => onToggleActive(service)}
      disabled={busy}
      aria-label={`${service.isActive ? "Disable" : "Enable"} ${service.name}`}
    >
      {service.isActive ? "Disable" : "Enable"}
    </Button>
  );
}

// Desktop: a table. Name and category wrap; the other columns keep their
// width, so nothing overlaps or scrolls sideways at 1024px.
export function ServiceTable({ services, busyIds, onEdit, onToggleActive }: ServiceListProps) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border bg-card lg:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-card">Service</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Pricing</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="pr-card text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.id} className={cn(!service.isActive && "text-muted-foreground")}>
              <TableCell className="pl-card whitespace-normal">
                <button
                  type="button"
                  onClick={() => onEdit(service)}
                  className={cn(
                    "type-label rounded-sm text-left break-words outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
                    service.isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {service.name}
                </button>
              </TableCell>
              <TableCell className="whitespace-normal break-words">
                {service.category ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>{PRICING_TYPE_LABELS[service.pricingType]}</TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  <span>{formatServicePrice(service)}</span>
                  {service.requiresQuote && <QuoteBadge />}
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge isActive={service.isActive} />
              </TableCell>
              <TableCell className="pr-card text-right">
                <div className="flex justify-end gap-2">
                  <Button variant="subtle" size="sm" onClick={() => onEdit(service)} aria-label={`Edit ${service.name}`}>
                    Edit
                  </Button>
                  <ToggleButton service={service} busy={busyIds.has(service.id)} onToggleActive={onToggleActive} compact />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// Mobile and tablet: stacked cards.
export function ServiceCards({ services, busyIds, onEdit, onToggleActive }: ServiceListProps) {
  return (
    <ul className="flex flex-col gap-component lg:hidden">
      {services.map((service) => (
        <li key={service.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-card">
          <div className="flex items-start justify-between gap-component">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className={cn("type-label break-words", service.isActive ? "text-foreground" : "text-muted-foreground")}>
                {service.name}
              </p>
              <p className="type-caption break-words text-muted-foreground">
                {[service.category, PRICING_TYPE_LABELS[service.pricingType]].filter(Boolean).join(" · ")}
              </p>
            </div>
            <StatusBadge isActive={service.isActive} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("type-body-sm font-medium", service.isActive ? "text-foreground" : "text-muted-foreground")}>
              {formatServicePrice(service)}
            </span>
            {service.requiresQuote && <QuoteBadge />}
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
            <Button variant="subtle" onClick={() => onEdit(service)} aria-label={`Edit ${service.name}`}>
              Edit
            </Button>
            <ToggleButton service={service} busy={busyIds.has(service.id)} onToggleActive={onToggleActive} />
          </div>
        </li>
      ))}
    </ul>
  );
}
