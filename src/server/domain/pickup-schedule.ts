import "server-only";

import { getPickupWindows, isValidSchedule, type PickupSchedule } from "@/lib/pickup-schedule";

// The pickup windows customers choose from (Feature 13 books against these).
// The maths lives in src/lib/pickup-schedule.ts so the fulfilment page's live
// preview runs the same code in the browser.
export { getPickupWindows };

export interface PickupAvailabilityInput extends PickupSchedule {
  pickupDeliveryEnabled: boolean;
  // Active (not disabled) service areas.
  activeAreaCount: number;
}

// Whether customers can book a pickup: pickup & delivery is on, the store
// covers at least one active area, and the schedule has at least one active
// day with valid hours.
export function isPickupAvailable({ pickupDeliveryEnabled, activeAreaCount, ...schedule }: PickupAvailabilityInput): boolean {
  return pickupDeliveryEnabled && activeAreaCount > 0 && isValidSchedule(schedule);
}
