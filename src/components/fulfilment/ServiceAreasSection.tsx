"use client";

import { MapPinIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { disableServiceArea, enableServiceArea, type AreaActionResult } from "@/actions/fulfilment";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FulfilmentArea } from "@/types/fulfilment";

import { AreaCards, AreaTable } from "./AreaList";
import { AreaSheet } from "./AreaSheet";

// How long the Undo button stays on a "disabled" toast.
const UNDO_TOAST_MS = 8000;

type SavedArea = Extract<AreaActionResult, { ok: true }>;

interface ServiceAreasSectionProps {
  // Sorted by name, with each saved copy shown at once (see FulfilmentSettings).
  areas: FulfilmentArea[];
  onSaved: (result: SavedArea) => void;
}

export function ServiceAreasSection({ areas, onSaved }: ServiceAreasSectionProps) {
  const [sheet, setSheet] = useState<{ open: boolean; areaId: string | null; formKey: number }>({
    open: false,
    areaId: null,
    formKey: 0,
  });
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const editing = sheet.areaId ? (areas.find((area) => area.id === sheet.areaId) ?? null) : null;


  function openAdd() {
    setSheet((current) => ({ open: true, areaId: null, formKey: current.formKey + 1 }));
  }

  function openEdit(area: FulfilmentArea) {
    setSheet((current) => ({ open: true, areaId: area.id, formKey: current.formKey + 1 }));
  }

  function closeSheet() {
    setSheet((current) => ({ ...current, open: false }));
  }

  async function withBusy(id: string, work: () => Promise<void>) {
    setBusyIds((current) => new Set(current).add(id));
    try {
      await work();
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  // Disabling is immediate on the server; Undo calls the same re-enable
  // action, for as long as the toast is shown.
  function toggleActive(area: FulfilmentArea) {
    closeSheet();
    if (!area.isActive) {
      enable(area);
      return;
    }
    void withBusy(area.id, async () => {
      const result = await disableServiceArea(area.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      onSaved(result);
      toast.success(`${result.area.name} disabled`, {
        description: "Hidden from new orders and bookings.",
        duration: UNDO_TOAST_MS,
        action: { label: "Undo", onClick: () => enable(area) },
      });
    });
  }

  function enable(area: FulfilmentArea) {
    void withBusy(area.id, async () => {
      const result = await enableServiceArea(area.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      onSaved(result);
      toast.success(`${result.area.name} is active again`);
    });
  }

  const addButton = (
    <Button onClick={openAdd}>
      <PlusIcon data-icon="inline-start" aria-hidden />
      Add area
    </Button>
  );

  return (
    <Card role="region" aria-labelledby="service-areas-title">
      <CardHeader className="flex flex-col gap-component md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1.5">
          <CardTitle id="service-areas-title" className="type-h3">
            Service areas
          </CardTitle>
          <CardDescription className="type-body-sm">
            The areas you pick up from and deliver to. Customers choose one when they book pickup, staff check it
            against the address.
          </CardDescription>
        </div>
        {areas.length > 0 && <div className="shrink-0">{addButton}</div>}
      </CardHeader>
      <CardContent className="flex flex-col gap-component">
        {areas.length === 0 ? (
          <EmptyState
            icon={MapPinIcon}
            title="No service areas yet"
            description="Add the areas you cover, with a fixed pickup & delivery charge or a quote."
            action={addButton}
          />
        ) : (
          <>
            <AreaTable areas={areas} busyIds={busyIds} onEdit={openEdit} onToggleActive={toggleActive} />
            <AreaCards areas={areas} busyIds={busyIds} onEdit={openEdit} onToggleActive={toggleActive} />
          </>
        )}
      </CardContent>

      <AreaSheet
        open={sheet.open}
        onOpenChange={(open) => !open && closeSheet()}
        area={editing}
        formKey={sheet.formKey}
        onSaved={(result) => {
          onSaved(result);
          closeSheet();
        }}
        onToggleActive={toggleActive}
        toggling={editing ? busyIds.has(editing.id) : false}
      />
    </Card>
  );
}
