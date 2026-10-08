"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/components/workspace/nav-items";
import type { StaffStatus } from "@/types/staff";

import type { StaffRow } from "./staff-rows";

export type StaffAction = "deactivate" | "reactivate" | "resend" | "revoke";

interface StaffListProps {
  rows: StaffRow[];
  // Rows with a request in flight.
  busyIds: ReadonlySet<string>;
  onAction: (row: StaffRow, action: StaffAction) => void;
}

const STATUS_BADGES: Record<StaffStatus, { label: string; variant: "success" | "neutral" | "info" | "warning" }> = {
  ACTIVE: { label: "Active", variant: "success" },
  DEACTIVATED: { label: "Deactivated", variant: "neutral" },
  INVITED: { label: "Invited", variant: "info" },
  INVITE_EXPIRED: { label: "Invite expired", variant: "warning" },
};

const ACTION_LABELS: Record<StaffAction, string> = {
  deactivate: "Deactivate",
  reactivate: "Reactivate",
  resend: "Resend",
  revoke: "Revoke",
};

// Owners have no actions: an owner can't deactivate themselves or another owner.
export function getStaffActions(row: StaffRow): StaffAction[] {
  if (row.role === "OWNER") return [];
  switch (row.status) {
    case "ACTIVE":
      return ["deactivate"];
    case "DEACTIVATED":
      return ["reactivate"];
    case "INVITED":
      return ["resend", "revoke"];
    case "INVITE_EXPIRED":
      return ["resend"];
  }
}

function StatusBadge({ status }: { status: StaffStatus }) {
  const badge = STATUS_BADGES[status];
  return (
    <Badge variant={badge.variant} dot>
      {badge.label}
    </Badge>
  );
}

function displayName(row: StaffRow): string {
  return row.name ?? "Invited";
}

function ActionButtons({ row, busy, onAction, compact = false }: {
  row: StaffRow;
  busy: boolean;
  onAction: StaffListProps["onAction"];
  // Small for table rows; full size (44px) on cards.
  compact?: boolean;
}) {
  return getStaffActions(row).map((action) => (
    <Button
      key={action}
      variant={action === "deactivate" || action === "revoke" ? "subtle-destructive" : "subtle"}
      size={compact ? "sm" : "default"}
      onClick={() => onAction(row, action)}
      disabled={busy}
      aria-label={`${ACTION_LABELS[action]} ${row.kind === "invitation" ? `invitation for ${row.email}` : displayName(row)}`}
    >
      {ACTION_LABELS[action]}
    </Button>
  ));
}

// Desktop: a table.
export function StaffTable({ rows, busyIds, onAction }: StaffListProps) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border bg-card lg:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-card">Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="pr-card text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.kind}-${row.id}`}>
              <TableCell className="pl-card whitespace-normal">
                <span className={row.name ? "type-label text-foreground" : "text-muted-foreground"}>
                  {displayName(row)}
                </span>
              </TableCell>
              <TableCell className="whitespace-normal break-all">{row.email}</TableCell>
              <TableCell>{ROLE_LABELS[row.role]}</TableCell>
              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">{row.dateLabel}</TableCell>
              <TableCell className="pr-card text-right">
                <div className="flex justify-end gap-2">
                  <ActionButtons row={row} busy={busyIds.has(row.id)} onAction={onAction} compact />
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
export function StaffCards({ rows, busyIds, onAction }: StaffListProps) {
  return (
    <ul className="flex flex-col gap-component lg:hidden">
      {rows.map((row) => {
        const actions = getStaffActions(row);
        return (
          <li key={`${row.kind}-${row.id}`} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-card">
            <div className="flex items-start justify-between gap-component">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className={row.name ? "type-label break-words text-foreground" : "type-label text-muted-foreground"}>
                  {displayName(row)}
                </p>
                <p className="type-body-sm break-all text-muted-foreground">{row.email}</p>
              </div>
              <StatusBadge status={row.status} />
            </div>
            <p className="type-caption text-muted-foreground">
              {ROLE_LABELS[row.role]} · {row.dateLabel}
            </p>
            {actions.length > 0 && (
              <div className={`grid gap-2 border-t border-border pt-3 ${actions.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                <ActionButtons row={row} busy={busyIds.has(row.id)} onAction={onAction} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
