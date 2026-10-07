"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAreaCharge } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { FulfilmentArea } from "@/types/fulfilment";

interface AreaListProps {
  areas: FulfilmentArea[];
  // Areas with a disable/enable request in flight.
  busyIds: ReadonlySet<string>;
  onEdit: (area: FulfilmentArea) => void;
  onToggleActive: (area: FulfilmentArea) => void;
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

function Charge({ area }: { area: FulfilmentArea }) {
  return area.chargeType === "QUOTE_REQUIRED" ? (
    <Badge variant="info">Quote required</Badge>
  ) : (
    <span>{formatAreaCharge(area)}</span>
  );
}

function ToggleButton({ area, busy, onToggleActive, compact = false }: {
  area: FulfilmentArea;
  busy: boolean;
  onToggleActive: (area: FulfilmentArea) => void;
  // Small for table rows; full size (44px) on cards.
  compact?: boolean;
}) {
  return (
    <Button
      variant={area.isActive ? "subtle-destructive" : "subtle"}
      size={compact ? "sm" : "default"}
      onClick={() => onToggleActive(area)}
      disabled={busy}
      aria-label={`${area.isActive ? "Disable" : "Enable"} ${area.name}`}
    >
      {area.isActive ? "Disable" : "Enable"}
    </Button>
  );
}

// Desktop: a table.
export function AreaTable({ areas, busyIds, onEdit, onToggleActive }: AreaListProps) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border bg-card lg:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-card">Area</TableHead>
            <TableHead>Charge</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="pr-card text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {areas.map((area) => (
            <TableRow key={area.id} className={cn(!area.isActive && "text-muted-foreground")}>
              <TableCell className="pl-card whitespace-normal">
                <button
                  type="button"
                  onClick={() => onEdit(area)}
                  className={cn(
                    "type-label rounded-sm text-left break-words outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
                    area.isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {area.name}
                </button>
              </TableCell>
              <TableCell>
                <Charge area={area} />
              </TableCell>
              <TableCell>
                <StatusBadge isActive={area.isActive} />
              </TableCell>
              <TableCell className="pr-card text-right">
                <div className="flex justify-end gap-2">
                  <Button variant="subtle" size="sm" onClick={() => onEdit(area)} aria-label={`Edit ${area.name}`}>
                    Edit
                  </Button>
                  <ToggleButton area={area} busy={busyIds.has(area.id)} onToggleActive={onToggleActive} compact />
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
export function AreaCards({ areas, busyIds, onEdit, onToggleActive }: AreaListProps) {
  return (
    <ul className="flex flex-col gap-component lg:hidden">
      {areas.map((area) => (
        <li key={area.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-card">
          <div className="flex items-start justify-between gap-component">
            <div className="flex min-w-0 flex-col gap-1">
              <p className={cn("type-label break-words", area.isActive ? "text-foreground" : "text-muted-foreground")}>
                {area.name}
              </p>
              <div className={cn("type-body-sm", area.isActive ? "text-foreground" : "text-muted-foreground")}>
                <Charge area={area} />
              </div>
            </div>
            <StatusBadge isActive={area.isActive} />
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
            <Button variant="subtle" onClick={() => onEdit(area)} aria-label={`Edit ${area.name}`}>
              Edit
            </Button>
            <ToggleButton area={area} busy={busyIds.has(area.id)} onToggleActive={onToggleActive} />
          </div>
        </li>
      ))}
    </ul>
  );
}
