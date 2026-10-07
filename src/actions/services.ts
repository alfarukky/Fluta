"use server";

import { revalidatePath } from "next/cache";

import { serviceFormSchema, serviceIdSchema } from "@/schemas/services";
import { ownerEditRefusalMessage } from "@/server/auth/access";
import { requireOwnerCanEdit } from "@/server/auth/session";
import {
  createCatalogueService,
  setCatalogueServiceActive,
  updateCatalogueService,
  type ServiceSaveError,
  type ServiceSaveResult,
} from "@/server/services/service-catalogue";
import type { CatalogueService } from "@/types/services";

// Owner-only service catalogue actions. Each one checks the membership itself
// (every action is its own request) and that the store may be edited
// (requireOwnerCanEdit), and the store is always the owner's own
// store from that membership: any store ID in the form data is ignored, and a
// service ID is only acted on if it belongs to that store.

export type ServiceActionResult =
  | { ok: true; message: string; service: CatalogueService }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const SERVICE_FIELDS = ["name", "category", "pricingType", "price", "requiresQuote"] as const;

const NOT_OWNER = "Only the store owner can change services.";
const SAVE_FAILED = "We couldn't save this service. Please try again.";

const SAVE_ERRORS: Record<ServiceSaveError, { message: string; field?: string }> = {
  DUPLICATE_NAME: { message: "A service with this name already exists.", field: "name" },
  DUPLICATE_DISABLED_NAME: {
    message: "A disabled service with this name exists. Re-enable it instead.",
    field: "name",
  },
  NOT_FOUND: { message: "This service no longer exists. Refresh the page and try again." },
};

export async function createService(formData: FormData): Promise<ServiceActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const parsed = serviceFormSchema.safeParse(pick(formData, SERVICE_FIELDS));
  if (!parsed.success) return invalid(parsed.error.issues);

  return run("creating a service", () => createCatalogueService(member.store.id, parsed.data), "Service added");
}

export async function updateService(serviceId: string, formData: FormData): Promise<ServiceActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const id = serviceIdSchema.safeParse(serviceId);
  if (!id.success) return { ok: false, message: SAVE_ERRORS.NOT_FOUND.message };
  const parsed = serviceFormSchema.safeParse(pick(formData, SERVICE_FIELDS));
  if (!parsed.success) return invalid(parsed.error.issues);

  return run("updating a service", () => updateCatalogueService(member.store.id, id.data, parsed.data), "Service saved");
}

export async function disableService(serviceId: string): Promise<ServiceActionResult> {
  return setActive(serviceId, false);
}

export async function enableService(serviceId: string): Promise<ServiceActionResult> {
  return setActive(serviceId, true);
}

async function setActive(serviceId: string, isActive: boolean): Promise<ServiceActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const id = serviceIdSchema.safeParse(serviceId);
  if (!id.success) return { ok: false, message: SAVE_ERRORS.NOT_FOUND.message };

  return run(
    isActive ? "enabling a service" : "disabling a service",
    () => setCatalogueServiceActive(member.store.id, id.data, isActive),
    isActive ? "Service enabled" : "Service disabled",
  );
}

async function run(
  step: string,
  save: () => Promise<ServiceSaveResult>,
  successMessage: string,
): Promise<ServiceActionResult> {
  let result: ServiceSaveResult;
  try {
    result = await save();
  } catch (error) {
    console.error(`[services] ${step} failed:`, describeError(error));
    return { ok: false, message: SAVE_FAILED };
  }
  if (!result.ok) {
    const { message, field } = SAVE_ERRORS[result.error];
    return { ok: false, message, fieldErrors: field ? { [field]: message } : undefined };
  }

  revalidatePath("/services");
  return { ok: true, message: successMessage, service: result.service };
}

// Only the named fields, as strings (a missing field is ""; a file is left
// as-is so Zod rejects it).
function pick(formData: FormData, fields: readonly string[]): Record<string, FormDataEntryValue> {
  return Object.fromEntries(fields.map((field) => [field, formData.get(field) ?? ""]));
}

function invalid(issues: readonly { path: PropertyKey[]; message: string }[]): ServiceActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, message: "Check the highlighted fields and try again.", fieldErrors };
}

// The error's class and Prisma code only, never the message (which can repeat
// the query's values).
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
