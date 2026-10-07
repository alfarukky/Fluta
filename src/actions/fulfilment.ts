"use server";

import { revalidatePath } from "next/cache";

import { getLocalDateKey } from "@/lib/time";
import {
  closedDateFormSchema,
  FULFILMENT_OPTION_LABELS,
  fulfilmentOptionSchema,
  recordIdSchema,
  scheduleFormSchema,
  serviceAreaFormSchema,
} from "@/schemas/fulfilment";
import { ownerEditRefusalMessage } from "@/server/auth/access";
import { requireOwnerCanEdit } from "@/server/auth/session";
import {
  addClosedDate as saveClosedDate,
  changeFulfilmentOption,
  createServiceArea as saveNewArea,
  editServiceArea,
  getPickupAvailability,
  isPickupDeliveryEnabled,
  removeClosedDate as deleteClosedDate,
  saveSchedule as saveStoreSchedule,
  setAreaActive,
  type AreaSaveError,
  type AreaSaveResult,
  type FulfilmentOptions,
  type FulfilmentSchedule,
} from "@/server/services/fulfilment-settings";
import type { FulfilmentArea, FulfilmentClosedDate } from "@/types/fulfilment";

// Owner-only fulfilment actions. Each one checks the membership itself (every
// action is its own request) and that the store may be edited
// (requireOwnerCanEdit), and the store is always the owner's own store from
// that membership: any store ID in the form data is ignored, and an area or
// closed-date ID is only acted on if it belongs to that store.

type Failure = { ok: false; message: string; fieldErrors?: Record<string, string> };

// pickupAvailable: whether customers can book a pickup after this change
// (isPickupAvailable), so the page's warning updates at once.
export type OptionActionResult =
  | { ok: true; message: string; options: FulfilmentOptions; pickupAvailable: boolean }
  | (Failure & { options?: FulfilmentOptions });
export type ScheduleActionResult =
  | { ok: true; message: string; schedule: FulfilmentSchedule; pickupAvailable: boolean }
  | Failure;
export type AreaActionResult = { ok: true; message: string; area: FulfilmentArea; pickupAvailable: boolean } | Failure;
export type ClosedDateActionResult = { ok: true; message: string; closedDate: FulfilmentClosedDate } | Failure;
export type RemoveClosedDateResult = { ok: true; message: string } | Failure;

const NOT_OWNER = "Only the store owner can change fulfilment settings.";
const SAVE_FAILED = "We couldn't save your changes. Please try again.";
const LAST_OPTION =
  "Keep at least one way for customers to get their laundry to you. Turn the other option on first.";
const CLOSED_DATE_NOT_FOUND = "This closed date was already removed. Refresh the page to see the latest list.";

const AREA_ERRORS: Record<AreaSaveError, { message: string; field?: string }> = {
  DUPLICATE_NAME: { message: "An area with this name already exists.", field: "name" },
  DUPLICATE_DISABLED_NAME: {
    message: "A disabled area with this name exists. Re-enable it instead.",
    field: "name",
  },
  NOT_FOUND: { message: "This area no longer exists. Refresh the page and try again." },
};

export async function setFulfilmentOption(option: string, enabled: boolean): Promise<OptionActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const parsed = fulfilmentOptionSchema.safeParse(option);
  if (!parsed.success || typeof enabled !== "boolean") return { ok: false, message: SAVE_FAILED };

  try {
    const { updated, options } = await changeFulfilmentOption(member.store.id, parsed.data, enabled);
    if (!updated) return { ok: false, message: LAST_OPTION, options };
    revalidatePath("/fulfilment");
    const label = FULFILMENT_OPTION_LABELS[parsed.data];
    return {
      ok: true,
      message: `${label} ${enabled ? "turned on" : "turned off"}`,
      options,
      pickupAvailable: await getPickupAvailability(member.store.id),
    };
  } catch (error) {
    console.error("[fulfilment] changing an option failed:", describeError(error));
    return { ok: false, message: SAVE_FAILED };
  }
}

export async function saveSchedule(formData: FormData): Promise<ScheduleActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  try {
    const parsed = scheduleFormSchema(await isPickupDeliveryEnabled(member.store.id)).safeParse({
      activeDays: formData.getAll("activeDays"),
      openTime: formData.get("openTime") ?? "",
      closeTime: formData.get("closeTime") ?? "",
    });
    if (!parsed.success) return invalid(parsed.error.issues);

    const schedule = await saveStoreSchedule(member.store.id, parsed.data);
    revalidatePath("/fulfilment");
    return {
      ok: true,
      message: "Pickup & delivery schedule saved",
      schedule,
      pickupAvailable: await getPickupAvailability(member.store.id),
    };
  } catch (error) {
    console.error("[fulfilment] saving the schedule failed:", describeError(error));
    return { ok: false, message: SAVE_FAILED };
  }
}

export async function createServiceArea(formData: FormData): Promise<AreaActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const parsed = serviceAreaFormSchema.safeParse(pick(formData, ["name", "chargeType", "fixedCharge"]));
  if (!parsed.success) return invalid(parsed.error.issues);

  return runArea("creating an area", member.store.id, () => saveNewArea(member.store.id, parsed.data), "Area added");
}

export async function updateServiceArea(areaId: string, formData: FormData): Promise<AreaActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const id = recordIdSchema.safeParse(areaId);
  if (!id.success) return { ok: false, message: AREA_ERRORS.NOT_FOUND.message };
  const parsed = serviceAreaFormSchema.safeParse(pick(formData, ["name", "chargeType", "fixedCharge"]));
  if (!parsed.success) return invalid(parsed.error.issues);

  return runArea(
    "updating an area",
    member.store.id,
    () => editServiceArea(member.store.id, id.data, parsed.data),
    "Area saved",
  );
}

export async function disableServiceArea(areaId: string): Promise<AreaActionResult> {
  return setActive(areaId, false);
}

export async function enableServiceArea(areaId: string): Promise<AreaActionResult> {
  return setActive(areaId, true);
}

async function setActive(areaId: string, isActive: boolean): Promise<AreaActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const id = recordIdSchema.safeParse(areaId);
  if (!id.success) return { ok: false, message: AREA_ERRORS.NOT_FOUND.message };

  return runArea(
    isActive ? "enabling an area" : "disabling an area",
    member.store.id,
    () => setAreaActive(member.store.id, id.data, isActive),
    isActive ? "Area enabled" : "Area disabled",
  );
}

export async function addClosedDate(formData: FormData): Promise<ClosedDateActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const today = getLocalDateKey(new Date(), member.store.timeZone);
  const parsed = closedDateFormSchema(today).safeParse(pick(formData, ["date", "note"]));
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await saveClosedDate(member.store.id, parsed.data);
    if (!result.ok) {
      const message = "This date is already closed.";
      return { ok: false, message, fieldErrors: { date: message } };
    }
    revalidatePath("/fulfilment");
    return { ok: true, message: "Closed date added", closedDate: result.closedDate };
  } catch (error) {
    console.error("[fulfilment] adding a closed date failed:", describeError(error));
    return { ok: false, message: SAVE_FAILED };
  }
}

export async function removeClosedDate(closedDateId: string): Promise<RemoveClosedDateResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const id = recordIdSchema.safeParse(closedDateId);
  if (!id.success) return { ok: false, message: CLOSED_DATE_NOT_FOUND };

  try {
    if (!(await deleteClosedDate(member.store.id, id.data))) return { ok: false, message: CLOSED_DATE_NOT_FOUND };
  } catch (error) {
    console.error("[fulfilment] removing a closed date failed:", describeError(error));
    return { ok: false, message: SAVE_FAILED };
  }
  revalidatePath("/fulfilment");
  return { ok: true, message: "Closed date removed" };
}

async function runArea(
  step: string,
  storeId: string,
  save: () => Promise<AreaSaveResult>,
  successMessage: string,
): Promise<AreaActionResult> {
  try {
    const result = await save();
    if (!result.ok) {
      const { message, field } = AREA_ERRORS[result.error];
      return { ok: false, message, fieldErrors: field ? { [field]: message } : undefined };
    }
    revalidatePath("/fulfilment");
    return { ok: true, message: successMessage, area: result.area, pickupAvailable: await getPickupAvailability(storeId) };
  } catch (error) {
    console.error(`[fulfilment] ${step} failed:`, describeError(error));
    return { ok: false, message: SAVE_FAILED };
  }
}

// Only the named fields, as strings (a missing field is ""; a file is left
// as-is so Zod rejects it).
function pick(formData: FormData, fields: readonly string[]): Record<string, FormDataEntryValue> {
  return Object.fromEntries(fields.map((field) => [field, formData.get(field) ?? ""]));
}

function invalid(issues: readonly { path: PropertyKey[]; message: string }[]): Failure {
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
