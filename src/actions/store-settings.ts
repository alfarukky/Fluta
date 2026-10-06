"use server";

import { revalidatePath } from "next/cache";

import { formatPhone } from "@/lib/phone";
import { storeBrandingSchema, storeProfileSchema } from "@/schemas/store-settings";
import { requireStoreMember } from "@/server/auth/session";
import { removeStoreLogo as removeLogo, saveStoreBranding as saveBranding, saveStoreProfile as saveProfile } from "@/server/services/store-settings";

// Owner-only settings actions. Each one checks the membership itself (every
// action is its own request), and the store is always the owner's own store
// from that membership: any store ID in the form data is ignored.

export interface ProfileFormValues {
  name: string;
  description: string;
  address: string;
  phone: string;
  email: string;
}

export interface BrandingFormValues {
  primaryColor: string;
  accentColor: string;
}

export type SettingsActionResult<Values = undefined> =
  | { ok: true; message: string; values: Values }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const NOT_OWNER = "Only the store owner can change store settings.";
const SAVE_FAILED = "We couldn't save your changes. Please try again.";

export async function saveStoreProfile(formData: FormData): Promise<SettingsActionResult<ProfileFormValues>> {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) return { ok: false, message: NOT_OWNER };

  const parsed = storeProfileSchema.safeParse(pick(formData, ["name", "description", "address", "phone", "email"]));
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    await saveProfile(member.store.id, parsed.data);
  } catch (error) {
    console.error("[store-settings] saving the profile failed:", describeError(error));
    return { ok: false, message: SAVE_FAILED };
  }
  revalidatePath("/", "layout");

  const profile = parsed.data;
  return {
    ok: true,
    message: "Store information saved",
    values: {
      name: profile.name,
      description: profile.description ?? "",
      address: profile.address ?? "",
      phone: profile.phone ? formatPhone(profile.phone) : "",
      email: profile.email ?? "",
    },
  };
}

export async function saveStoreBranding(formData: FormData): Promise<SettingsActionResult<BrandingFormValues>> {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) return { ok: false, message: NOT_OWNER };

  const parsed = storeBrandingSchema.safeParse(pick(formData, ["primaryColor", "accentColor"]));
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    await saveBranding(member.store.id, parsed.data);
  } catch (error) {
    console.error("[store-settings] saving branding failed:", describeError(error));
    return { ok: false, message: SAVE_FAILED };
  }
  revalidatePath("/", "layout");

  return {
    ok: true,
    message: "Brand colours saved",
    values: { primaryColor: parsed.data.primaryColor ?? "", accentColor: parsed.data.accentColor ?? "" },
  };
}

export async function removeStoreLogo(): Promise<SettingsActionResult> {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) return { ok: false, message: NOT_OWNER };

  try {
    await removeLogo(member.store.id);
  } catch (error) {
    console.error("[store-settings] removing the logo failed:", describeError(error));
    return { ok: false, message: "We couldn't remove your logo. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Logo removed", values: undefined };
}

// Only the named fields, as strings (a missing field is ""; a file is left
// as-is so Zod rejects it).
function pick(formData: FormData, fields: readonly string[]): Record<string, FormDataEntryValue> {
  return Object.fromEntries(fields.map((field) => [field, formData.get(field) ?? ""]));
}

function invalid(issues: readonly { path: PropertyKey[]; message: string }[]): SettingsActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, message: "Check the highlighted fields and try again.", fieldErrors };
}

// The error's class and Prisma code only: Prisma messages can repeat the
// query's values (the store's phone and address), which must never be logged.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
