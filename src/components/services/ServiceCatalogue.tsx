"use client";

import { PlusIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { disableService, enableService } from "@/actions/services";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getNavItem } from "@/components/workspace/nav-items";
import { PageHeader } from "@/components/workspace/PageHeader";
import type { CatalogueService } from "@/types/services";

import { ServiceCards, ServiceTable } from "./ServiceList";
import {
  ALL_CATEGORIES,
  categoryOptions,
  categorySuggestions,
  filterServices,
  rememberSavedService,
  sortServices,
  withSavedServices,
  type SavedServices,
} from "./service-list";
import { ServiceSheet } from "./ServiceSheet";

// How long the Undo button stays on a "disabled" toast.
const UNDO_TOAST_MS = 8000;

interface ServiceCatalogueProps {
  // From the server, refreshed after every save (the actions revalidate /services).
  services: CatalogueService[];
}

export function ServiceCatalogue({ services: listed }: ServiceCatalogueProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [sheet, setSheet] = useState<{ open: boolean; serviceId: string | null; formKey: number }>({
    open: false,
    serviceId: null,
    formKey: 0,
  });
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<SavedServices>(new Map());

  // Each action returns the saved service; show it at once instead of waiting
  // about a second for the page's refreshed data.
  const services = useMemo(() => withSavedServices(listed, saved), [listed, saved]);
  function remember(service: CatalogueService) {
    setSaved((current) => rememberSavedService(current, service, listed));
  }

  const sorted = useMemo(() => sortServices(services), [services]);
  const options = useMemo(() => categoryOptions(services), [services]);
  const suggestions = useMemo(() => categorySuggestions(services), [services]);
  // A filter for a category that no longer exists shows everything.
  const activeCategory = options.some((option) => option.value === category) ? category : ALL_CATEGORIES;
  const visible = filterServices(sorted, { query, category: activeCategory });
  const editing = sheet.serviceId ? (services.find((service) => service.id === sheet.serviceId) ?? null) : null;

  function openAdd() {
    setSheet((current) => ({ open: true, serviceId: null, formKey: current.formKey + 1 }));
  }

  function openEdit(service: CatalogueService) {
    setSheet((current) => ({ open: true, serviceId: service.id, formKey: current.formKey + 1 }));
  }

  function closeSheet() {
    setSheet((current) => ({ ...current, open: false }));
  }

  function clearFilters() {
    setQuery("");
    setCategory(ALL_CATEGORIES);
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
  function toggleActive(service: CatalogueService) {
    closeSheet();
    if (!service.isActive) {
      enable(service);
      return;
    }
    void withBusy(service.id, async () => {
      const result = await disableService(service.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      remember(result.service);
      toast.success(`${result.service.name} disabled`, {
        description: "Hidden from new orders and bookings.",
        duration: UNDO_TOAST_MS,
        action: { label: "Undo", onClick: () => enable(service) },
      });
    });
  }

  function enable(service: CatalogueService) {
    void withBusy(service.id, async () => {
      const result = await enableService(service.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      remember(result.service);
      toast.success(`${result.service.name} is active again`);
    });
  }

  const addButton = (
    <Button onClick={openAdd}>
      <PlusIcon data-icon="inline-start" aria-hidden />
      Add service
    </Button>
  );

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader
        title="Services"
        description="The services and prices your store offers."
        actions={services.length > 0 ? addButton : undefined}
      />

      {services.length === 0 ? (
        <EmptyState
          icon={getNavItem("/services").icon}
          title="No services yet"
          description="Add the services your store offers, with their prices, so staff can take orders and customers can book."
          action={addButton}
        />
      ) : (
        <section aria-label="Service catalogue" className="flex flex-col gap-component">
          <div className="flex flex-col gap-component md:flex-row">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search services"
                aria-label="Search services by name"
                className="pl-10"
              />
            </div>
            <Select value={activeCategory} onValueChange={setCategory}>
              <SelectTrigger aria-label="Filter by category" className="w-full md:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="type-caption text-muted-foreground" aria-live="polite">
            {visible.length === services.length
              ? `${services.length} ${services.length === 1 ? "service" : "services"}`
              : `Showing ${visible.length} of ${services.length} services`}
          </p>

          {visible.length === 0 ? (
            <EmptyState
              icon={SearchXIcon}
              title="No matching services"
              description="Try another name or category."
              action={
                <Button variant="outline" onClick={clearFilters}>
                  Clear search and filter
                </Button>
              }
            />
          ) : (
            <>
              <ServiceTable services={visible} busyIds={busyIds} onEdit={openEdit} onToggleActive={toggleActive} />
              <ServiceCards services={visible} busyIds={busyIds} onEdit={openEdit} onToggleActive={toggleActive} />
            </>
          )}
        </section>
      )}

      <ServiceSheet
        open={sheet.open}
        onOpenChange={(open) => !open && closeSheet()}
        service={editing}
        formKey={sheet.formKey}
        categories={suggestions}
        onSaved={(service) => {
          remember(service);
          closeSheet();
        }}
        onToggleActive={toggleActive}
        toggling={editing ? busyIds.has(editing.id) : false}
      />
    </main>
  );
}
