"use client";

import { useMemo, useState } from "react";

import { rememberSavedRecord, withSavedRecords, type SavedRecords } from "@/components/shared/saved-records";

import { PageHeader } from "@/components/workspace/PageHeader";
import { isValidSchedule } from "@/lib/pickup-schedule";
import type { FulfilmentArea, FulfilmentClosedDate } from "@/types/fulfilment";

import { FulfilmentOptionsSection, type FulfilmentOptionValues } from "./FulfilmentOptionsSection";
import { ScheduleSection, type ScheduleValues } from "./ScheduleSection";
import { ServiceAreasSection } from "./ServiceAreasSection";
import { sortAreas } from "./area-list";

interface FulfilmentSettingsProps {
  options: FulfilmentOptionValues;
  // From the server, refreshed after every save (the actions revalidate /fulfilment).
  areas: FulfilmentArea[];
  // Kobo, or null for no default fee.
  defaultDeliveryFee: number | null;
  schedule: ScheduleValues;
  closedDates: FulfilmentClosedDate[];
  // "YYYY-MM-DD" in the store's time zone.
  today: string;
  timeZoneLabel: string;
  // isPickupAvailable, worked out on the server; every action returns it again.
  pickupAvailable: boolean;
}

export function FulfilmentSettings(props: FulfilmentSettingsProps) {
  const [options, setOptions] = useState(props.options);
  const [schedule, setSchedule] = useState(props.schedule);
  const [pickupAvailable, setPickupAvailable] = useState(props.pickupAvailable);
  const [defaultDeliveryFee, setDefaultDeliveryFee] = useState(props.defaultDeliveryFee);
  const [savedAreas, setSavedAreas] = useState<SavedRecords<FulfilmentArea>>(new Map());

  // Each area action returns the saved area; show it at once instead of
  // waiting for the page's refreshed data (newest copy wins).
  const areas = useMemo(() => sortAreas(withSavedRecords(props.areas, savedAreas)), [props.areas, savedAreas]);

  // What the pickup warning lists; whether it shows is pickupAvailable's call.
  // A default fee (₦0 included) serves customers whatever their area.
  const servesAnArea = areas.some((area) => area.isActive) || defaultDeliveryFee !== null;
  const pickupMissing = [
    ...(servesAnArea ? [] : ["Add at least one active service area, or set a default fee"]),
    ...(isValidSchedule(schedule) ? [] : ["Set at least one active day and your pickup hours"]),
  ];

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader
        title="Fulfilment"
        description="How customers get their laundry to you, the areas you cover, and when you pick up and deliver."
      />

      <div className="flex max-w-4xl min-w-0 flex-col gap-grid">
        <FulfilmentOptionsSection
          options={options}
          pickupAvailable={pickupAvailable}
          pickupMissing={pickupMissing}
          onOptionsChange={setOptions}
          onSaved={(result) => {
            setOptions(result.options);
            setPickupAvailable(result.pickupAvailable);
          }}
        />

        <ServiceAreasSection
          areas={areas}
          defaultDeliveryFee={defaultDeliveryFee}
          onSaved={(result) => {
            setSavedAreas((current) => rememberSavedRecord(current, result.area, props.areas));
            setPickupAvailable(result.pickupAvailable);
          }}
          onDefaultFeeSaved={(result) => {
            setDefaultDeliveryFee(result.fee.defaultDeliveryFee);
            setPickupAvailable(result.pickupAvailable);
          }}
        />

        <ScheduleSection
          schedule={props.schedule}
          pickupDeliveryEnabled={options.pickupDeliveryEnabled}
          closedDates={props.closedDates}
          today={props.today}
          timeZoneLabel={props.timeZoneLabel}
          onSaved={(result) => {
            setSchedule(result.schedule);
            setPickupAvailable(result.pickupAvailable);
          }}
        />
      </div>
    </main>
  );
}
