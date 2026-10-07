import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { toMatchKey } from "@/lib/match-key";
import type { ServiceInput } from "@/schemas/services";
import {
  findServiceByNameKey,
  insertService,
  listServiceCategories,
  setServiceActive,
  updateService,
  type ServiceData,
  type ServiceRecord,
} from "@/server/data/services";

// The owner's service catalogue. storeId always comes from the caller's
// membership (see src/actions/services.ts). Name uniqueness is enforced by the
// database (@@unique([storeId, nameKey])), so two identical requests at once
// still produce one service; the loser gets the duplicate-name result.

export type ServiceSaveError = "DUPLICATE_NAME" | "DUPLICATE_DISABLED_NAME" | "NOT_FOUND";

export type ServiceSaveResult = { ok: true; service: ServiceRecord } | { ok: false; error: ServiceSaveError };

export async function createCatalogueService(storeId: string, input: ServiceInput): Promise<ServiceSaveResult> {
  const data = await toServiceData(storeId, input);
  try {
    return { ok: true, service: await insertService(storeId, data) };
  } catch (error) {
    return duplicateResult(storeId, data.nameKey, error);
  }
}

export async function updateCatalogueService(
  storeId: string,
  serviceId: string,
  input: ServiceInput,
): Promise<ServiceSaveResult> {
  const data = await toServiceData(storeId, input, serviceId);
  try {
    const service = await updateService(storeId, serviceId, data);
    return service ? { ok: true, service } : { ok: false, error: "NOT_FOUND" };
  } catch (error) {
    return duplicateResult(storeId, data.nameKey, error);
  }
}

export async function setCatalogueServiceActive(
  storeId: string,
  serviceId: string,
  isActive: boolean,
): Promise<ServiceSaveResult> {
  const service = await setServiceActive(storeId, serviceId, isActive);
  return service ? { ok: true, service } : { ok: false, error: "NOT_FOUND" };
}

// A category matching one the store already uses (ignoring case and extra
// spaces) takes the existing spelling. The service being edited is left out,
// so a category only it uses can still be re-spelt.
async function toServiceData(storeId: string, input: ServiceInput, serviceId?: string): Promise<ServiceData> {
  let category = input.category;
  if (category !== null) {
    const key = toMatchKey(category);
    const existing = await listServiceCategories(storeId, serviceId);
    category = existing.find((spelling) => toMatchKey(spelling) === key) ?? category;
  }
  return { ...input, category, nameKey: toMatchKey(input.name) };
}

// A unique-rule rejection is the duplicate-name result (worded differently
// when the existing service is disabled); anything else is rethrown.
async function duplicateResult(storeId: string, nameKey: string, error: unknown): Promise<ServiceSaveResult> {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  const existing = await findServiceByNameKey(storeId, nameKey);
  return { ok: false, error: existing && !existing.isActive ? "DUPLICATE_DISABLED_NAME" : "DUPLICATE_NAME" };
}
