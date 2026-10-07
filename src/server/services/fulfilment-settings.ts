import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { toMatchKey } from "@/lib/match-key";
import type { ClosedDateInput, FulfilmentOption, ScheduleInput, ServiceAreaInput } from "@/schemas/fulfilment";
import {
  countActiveServiceAreas,
  deleteClosedDate,
  findServiceAreaByNameKey,
  getFulfilmentOptionsAndSchedule,
  getFulfilmentSettings,
  insertClosedDate,
  insertServiceArea,
  setFulfilmentOption,
  setServiceAreaActive,
  updateSchedule,
  updateServiceArea,
  type FulfilmentOptions,
  type FulfilmentSchedule,
  type ServiceAreaData,
  type ServiceAreaRecord,
} from "@/server/data/fulfilment";
import { isPickupAvailable } from "@/server/domain/pickup-schedule";
import { getLocalDateKey } from "@/lib/time";
import type { FulfilmentClosedDate } from "@/types/fulfilment";

// The owner's fulfilment settings. storeId always comes from the caller's
// membership (see src/actions/fulfilment.ts). Area names and closed dates are
// unique per store in the database, so two identical requests at once still
// save one row; the loser gets the duplicate result.

export type { FulfilmentOptions, FulfilmentSchedule };

// False (with the options unchanged) when turning off the last option on.
export async function changeFulfilmentOption(
  storeId: string,
  option: FulfilmentOption,
  enabled: boolean,
): Promise<{ updated: boolean; options: FulfilmentOptions }> {
  return setFulfilmentOption(storeId, option, enabled);
}

// Whether pickup & delivery is on, which decides what the schedule requires.
export async function isPickupDeliveryEnabled(storeId: string): Promise<boolean> {
  return (await getFulfilmentOptionsAndSchedule(storeId)).pickupDeliveryEnabled;
}

export async function saveSchedule(storeId: string, schedule: ScheduleInput): Promise<FulfilmentSchedule> {
  return updateSchedule(storeId, schedule);
}

export type AreaSaveError = "DUPLICATE_NAME" | "DUPLICATE_DISABLED_NAME" | "NOT_FOUND";
export type AreaSaveResult = { ok: true; area: ServiceAreaRecord } | { ok: false; error: AreaSaveError };

export async function createServiceArea(storeId: string, input: ServiceAreaInput): Promise<AreaSaveResult> {
  const data = toAreaData(input);
  try {
    return { ok: true, area: await insertServiceArea(storeId, data) };
  } catch (error) {
    return duplicateAreaResult(storeId, data.nameKey, error);
  }
}

export async function editServiceArea(storeId: string, areaId: string, input: ServiceAreaInput): Promise<AreaSaveResult> {
  const data = toAreaData(input);
  try {
    const area = await updateServiceArea(storeId, areaId, data);
    return area ? { ok: true, area } : { ok: false, error: "NOT_FOUND" };
  } catch (error) {
    return duplicateAreaResult(storeId, data.nameKey, error);
  }
}

export async function setAreaActive(storeId: string, areaId: string, isActive: boolean): Promise<AreaSaveResult> {
  const area = await setServiceAreaActive(storeId, areaId, isActive);
  return area ? { ok: true, area } : { ok: false, error: "NOT_FOUND" };
}

export type ClosedDateResult = { ok: true; closedDate: FulfilmentClosedDate } | { ok: false; error: "DUPLICATE_DATE" };

export async function addClosedDate(storeId: string, input: ClosedDateInput): Promise<ClosedDateResult> {
  try {
    return { ok: true, closedDate: await insertClosedDate(storeId, input.date, input.note) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "DUPLICATE_DATE" };
    throw error;
  }
}

export async function removeClosedDate(storeId: string, closedDateId: string): Promise<boolean> {
  return deleteClosedDate(storeId, closedDateId);
}

// Everything the fulfilment page shows: options, areas, schedule, upcoming
// closed dates (from today in the store's time zone), and whether customers
// can book a pickup.
export async function loadFulfilmentSettings(storeId: string, timeZone: string, now: Date) {
  const today = getLocalDateKey(now, timeZone);
  const settings = await getFulfilmentSettings(storeId, today);
  const pickupAvailable = isPickupAvailable({
    ...settings,
    activeAreaCount: settings.areas.filter((area) => area.isActive).length,
  });
  return { ...settings, today, pickupAvailable };
}

// Whether customers can book a pickup with the store's current settings.
export async function getPickupAvailability(storeId: string): Promise<boolean> {
  const [settings, activeAreaCount] = await Promise.all([
    getFulfilmentOptionsAndSchedule(storeId),
    countActiveServiceAreas(storeId),
  ]);
  return isPickupAvailable({ ...settings, activeAreaCount });
}

function toAreaData(input: ServiceAreaInput): ServiceAreaData {
  return { ...input, nameKey: toMatchKey(input.name) };
}

// A unique-rule rejection is the duplicate-name result (worded differently
// when the existing area is disabled); anything else is rethrown.
async function duplicateAreaResult(storeId: string, nameKey: string, error: unknown): Promise<AreaSaveResult> {
  if (!isUniqueViolation(error)) throw error;
  const existing = await findServiceAreaByNameKey(storeId, nameKey);
  return { ok: false, error: existing && !existing.isActive ? "DUPLICATE_DISABLED_NAME" : "DUPLICATE_NAME" };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
