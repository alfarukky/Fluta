import "server-only";

import { Prisma, type AreaChargeType } from "@/generated/prisma/client";
import { fromDateKey, toDateKey } from "@/lib/time";
import type { FulfilmentArea, FulfilmentClosedDate } from "@/types/fulfilment";

import { getPrisma } from "./client";

// A store's fulfilment settings: options, service areas, schedule, and closed
// dates. storeId always comes from the caller's membership (requireStoreMember
// / requireOwnerCanEdit), never from the request, and is part of every where
// clause: an area or closed-date ID from another store matches nothing.
// Service areas are never deleted, only disabled.

const AREA_FIELDS = {
  id: true,
  name: true,
  chargeType: true,
  fixedCharge: true,
  isActive: true,
  updatedAt: true,
} as const;

export type ServiceAreaRecord = FulfilmentArea;

// What the server saves; nameKey comes from the name (toMatchKey).
export interface ServiceAreaData {
  name: string;
  nameKey: string;
  chargeType: AreaChargeType;
  fixedCharge: number | null;
}

export interface FulfilmentSchedule {
  activeDays: number[];
  openTime: string | null;
  closeTime: string | null;
}

export interface FulfilmentOptions {
  dropOffEnabled: boolean;
  pickupDeliveryEnabled: boolean;
}

const OPTION_AND_SCHEDULE_FIELDS = {
  dropOffEnabled: true,
  pickupDeliveryEnabled: true,
  activeDays: true,
  openTime: true,
  closeTime: true,
} as const;

// Everything the fulfilment page shows. Areas are unordered (the page sorts
// them by name, ignoring case); closed dates are those on or after `today`
// ("YYYY-MM-DD" in the store's time zone), soonest first.
export async function getFulfilmentSettings(storeId: string, today: string) {
  const store = await getPrisma().store.findUniqueOrThrow({
    where: { id: storeId },
    select: {
      ...OPTION_AND_SCHEDULE_FIELDS,
      timeZone: true,
      serviceAreas: { select: AREA_FIELDS },
      closedDates: {
        where: { date: { gte: fromDateKey(today) } },
        select: { id: true, date: true, note: true },
        orderBy: { date: "asc" },
      },
    },
  });
  const { serviceAreas, closedDates, ...settings } = store;
  return { ...settings, areas: serviceAreas, closedDates: closedDates.map(toClosedDateRecord) };
}

export async function getFulfilmentOptionsAndSchedule(storeId: string): Promise<FulfilmentOptions & FulfilmentSchedule> {
  return getPrisma().store.findUniqueOrThrow({ where: { id: storeId }, select: OPTION_AND_SCHEDULE_FIELDS });
}

// Turning an option on always succeeds. Turning one off only succeeds while
// the other is on (in the same statement, so two requests at once can't turn
// both off; the Store_fulfilment_option_check constraint backs this up).
// False if the option was the last one on.
export async function setFulfilmentOption(
  storeId: string,
  option: keyof FulfilmentOptions,
  enabled: boolean,
): Promise<{ updated: boolean; options: FulfilmentOptions }> {
  const other: keyof FulfilmentOptions = option === "dropOffEnabled" ? "pickupDeliveryEnabled" : "dropOffEnabled";
  const where: Prisma.StoreWhereInput = enabled ? { id: storeId } : { id: storeId, [other]: true };
  const { count } = await getPrisma().store.updateMany({ where, data: { [option]: enabled } });
  const options = await getPrisma().store.findUniqueOrThrow({
    where: { id: storeId },
    select: { dropOffEnabled: true, pickupDeliveryEnabled: true },
  });
  return { updated: count === 1, options };
}

export async function updateSchedule(storeId: string, schedule: FulfilmentSchedule): Promise<FulfilmentSchedule> {
  return getPrisma().store.update({
    where: { id: storeId },
    data: schedule,
    select: { activeDays: true, openTime: true, closeTime: true },
  });
}

export async function countActiveServiceAreas(storeId: string): Promise<number> {
  return getPrisma().serviceArea.count({ where: { storeId, isActive: true } });
}

export async function findServiceAreaByNameKey(
  storeId: string,
  nameKey: string,
): Promise<{ id: string; isActive: boolean } | null> {
  return getPrisma().serviceArea.findUnique({
    where: { storeId_nameKey: { storeId, nameKey } },
    select: { id: true, isActive: true },
  });
}

// Throws Prisma's unique-constraint error (P2002) if the store already has an
// area with this nameKey.
export async function insertServiceArea(storeId: string, data: ServiceAreaData): Promise<ServiceAreaRecord> {
  return getPrisma().serviceArea.create({ data: { ...data, storeId }, select: AREA_FIELDS });
}

// Null if the store has no such area. Throws P2002 like insertServiceArea.
export async function updateServiceArea(
  storeId: string,
  id: string,
  data: ServiceAreaData,
): Promise<ServiceAreaRecord | null> {
  return nullIfNotFound(
    getPrisma().serviceArea.update({ where: { storeId_id: { storeId, id } }, data, select: AREA_FIELDS }),
  );
}

// Null if the store has no such area.
export async function setServiceAreaActive(
  storeId: string,
  id: string,
  isActive: boolean,
): Promise<ServiceAreaRecord | null> {
  return nullIfNotFound(
    getPrisma().serviceArea.update({
      where: { storeId_id: { storeId, id } },
      data: { isActive },
      select: AREA_FIELDS,
    }),
  );
}

// Throws P2002 if the store already has this date closed (@@unique([storeId, date])).
export async function insertClosedDate(
  storeId: string,
  date: string,
  note: string | null,
): Promise<FulfilmentClosedDate> {
  const row = await getPrisma().closedDate.create({
    data: { storeId, date: fromDateKey(date), note },
    select: { id: true, date: true, note: true },
  });
  return toClosedDateRecord(row);
}

// False if the store has no such closed date.
export async function deleteClosedDate(storeId: string, id: string): Promise<boolean> {
  const { count } = await getPrisma().closedDate.deleteMany({ where: { id, storeId } });
  return count === 1;
}

function toClosedDateRecord(row: { id: string; date: Date; note: string | null }): FulfilmentClosedDate {
  return { id: row.id, date: toDateKey(row.date), note: row.note };
}

// The compound key (storeId, id) is what keeps another store's area out of
// reach: an ID from another store matches no row, which Prisma reports as P2025.
async function nullIfNotFound<T>(query: Promise<T>): Promise<T | null> {
  try {
    return await query;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
    throw error;
  }
}

const ORDERABLE_AREA_FIELDS = { id: true, name: true, chargeType: true, fixedCharge: true } as const;

export interface OrderableArea {
  id: string;
  name: string;
  chargeType: AreaChargeType;
  fixedCharge: number | null;
}

// The active areas staff can choose for a pickup order, alphabetically.
export async function listActiveServiceAreas(storeId: string): Promise<OrderableArea[]> {
  return getPrisma().serviceArea.findMany({
    where: { storeId, isActive: true },
    select: ORDERABLE_AREA_FIELDS,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

// Null for an area of another store, or a disabled one.
export async function findActiveServiceArea(storeId: string, id: string): Promise<OrderableArea | null> {
  return getPrisma().serviceArea.findFirst({ where: { storeId, id, isActive: true }, select: ORDERABLE_AREA_FIELDS });
}

// Closed dates on or after `today` ("YYYY-MM-DD"), as "YYYY-MM-DD".
export async function listClosedDateKeys(storeId: string, today: string): Promise<string[]> {
  const rows = await getPrisma().closedDate.findMany({
    where: { storeId, date: { gte: fromDateKey(today) } },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  return rows.map((row) => toDateKey(row.date));
}

export async function isClosedDate(storeId: string, date: string): Promise<boolean> {
  const row = await getPrisma().closedDate.findUnique({
    where: { storeId_date: { storeId, date: fromDateKey(date) } },
    select: { id: true },
  });
  return row !== null;
}
