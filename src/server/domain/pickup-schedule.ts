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
  // Kobo, for areas not in the list. Null means only listed areas; 0 is free.
  defaultDeliveryFee: number | null;
}

// Whether customers can book a pickup: pickup & delivery is on, the store
// covers at least one active area or has a default fee (any amount, ₦0
// included), and the schedule has at least one active day with valid hours.
export function isPickupAvailable({
  pickupDeliveryEnabled,
  activeAreaCount,
  defaultDeliveryFee,
  ...schedule
}: PickupAvailabilityInput): boolean {
  const servesAnArea = activeAreaCount > 0 || defaultDeliveryFee !== null;
  return pickupDeliveryEnabled && servesAnArea && isValidSchedule(schedule);
}
