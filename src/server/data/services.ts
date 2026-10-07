import "server-only";

import { Prisma, type PricingType } from "@/generated/prisma/client";
import type { CatalogueService } from "@/types/services";

import { getPrisma } from "./client";

// The store's service catalogue. storeId always comes from the caller's
// membership (requireStoreMember), never from the request, and is part of
// every where clause: a service ID from another store matches nothing.
// Services are never deleted, only disabled.

const SERVICE_FIELDS = {
  id: true,
  name: true,
  category: true,
  pricingType: true,
  price: true,
  requiresQuote: true,
  isActive: true,
  updatedAt: true,
} as const;

// The services page's shape (src/types/services.ts), so client code can use it.
export type ServiceRecord = CatalogueService;

// What the server saves; nameKey comes from the name (toMatchKey).
export interface ServiceData {
  name: string;
  nameKey: string;
  category: string | null;
  pricingType: PricingType;
  price: number;
  requiresQuote: boolean;
}

// Unordered: the services page loads a store's whole catalogue and sorts it
// itself (sortServices), ignoring case, which the database collation doesn't.
export async function listServices(storeId: string): Promise<ServiceRecord[]> {
  return getPrisma().service.findMany({ where: { storeId }, select: SERVICE_FIELDS });
}

// Every category the store uses, optionally ignoring one service (the one
// being edited, so its owner can still fix the spelling of a category only it
// uses).
export async function listServiceCategories(storeId: string, exceptServiceId?: string): Promise<string[]> {
  const rows = await getPrisma().service.findMany({
    where: { storeId, category: { not: null }, ...(exceptServiceId ? { id: { not: exceptServiceId } } : {}) },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.flatMap((row) => (row.category === null ? [] : [row.category]));
}

export async function findServiceByNameKey(
  storeId: string,
  nameKey: string,
): Promise<{ id: string; isActive: boolean } | null> {
  return getPrisma().service.findUnique({
    where: { storeId_nameKey: { storeId, nameKey } },
    select: { id: true, isActive: true },
  });
}

// Throws Prisma's unique-constraint error (P2002) if the store already has a
// service with this nameKey.
export async function insertService(storeId: string, data: ServiceData): Promise<ServiceRecord> {
  return getPrisma().service.create({ data: { ...data, storeId }, select: SERVICE_FIELDS });
}

// Null if the store has no such service. Throws P2002 like insertService.
export async function updateService(storeId: string, id: string, data: ServiceData): Promise<ServiceRecord | null> {
  return nullIfNotFound(
    getPrisma().service.update({ where: { storeId_id: { storeId, id } }, data, select: SERVICE_FIELDS }),
  );
}

// Null if the store has no such service.
export async function setServiceActive(storeId: string, id: string, isActive: boolean): Promise<ServiceRecord | null> {
  return nullIfNotFound(
    getPrisma().service.update({ where: { storeId_id: { storeId, id } }, data: { isActive }, select: SERVICE_FIELDS }),
  );
}

// The compound key (storeId, id) is what keeps another store's service out of
// reach: an ID from another store matches no row, which Prisma reports as P2025.
async function nullIfNotFound<T>(query: Promise<T>): Promise<T | null> {
  try {
    return await query;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
    throw error;
  }
}
