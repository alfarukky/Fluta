import "server-only";

import { createLogoKey, getLogoUrl } from "@/lib/logo-url";
import type { StoreBranding, StoreProfile } from "@/schemas/store-settings";
import { replaceStoreLogoKey, updateStoreBranding, updateStoreProfile } from "@/server/data/stores";
import { checkLogoFile, type LogoFileError } from "@/server/domain/logo-file";
import { getObjectStorage } from "@/server/integrations/r2";

// Store settings for the owner's own store. storeId always comes from the
// caller's membership (see src/actions/store-settings.ts and the logo route).

export async function saveStoreProfile(storeId: string, profile: StoreProfile): Promise<void> {
  await updateStoreProfile(storeId, profile);
}

export async function saveStoreBranding(storeId: string, branding: StoreBranding): Promise<void> {
  await updateStoreBranding(storeId, branding);
}

export type LogoUploadResult =
  | { ok: true; logoUrl: string | null }
  | { ok: false; error: LogoFileError | "UPLOAD_FAILED" | "SAVE_FAILED" };

// Check the file → upload under a new Fluta-generated key → save the key →
// delete the old file. If saving fails, the new file is deleted again. A failed
// delete is logged, never reported as a failed save.
export async function uploadStoreLogo(storeId: string, bytes: Uint8Array): Promise<LogoUploadResult> {
  const check = checkLogoFile(bytes);
  if (!check.ok) return { ok: false, error: check.error };

  const storage = getObjectStorage();
  const logoKey = createLogoKey(storeId, check.type.extension);
  try {
    await storage.put(logoKey, bytes, check.type.contentType);
  } catch (error) {
    logStorageError("upload", logoKey, error);
    return { ok: false, error: "UPLOAD_FAILED" };
  }

  let previousKey: string | null;
  try {
    previousKey = await replaceStoreLogoKey(storeId, logoKey);
  } catch (error) {
    logStorageError("save", logoKey, error);
    await deleteQuietly(logoKey);
    return { ok: false, error: "SAVE_FAILED" };
  }

  if (previousKey) await deleteQuietly(previousKey);
  return { ok: true, logoUrl: getLogoUrl({ logoKey }) };
}

// Clear the key, then delete the file.
export async function removeStoreLogo(storeId: string): Promise<void> {
  const previousKey = await replaceStoreLogoKey(storeId, null);
  if (previousKey) await deleteQuietly(previousKey);
}

async function deleteQuietly(key: string): Promise<void> {
  try {
    await getObjectStorage().delete(key);
  } catch (error) {
    logStorageError("delete", key, error);
  }
}

// Keys hold only the store ID and a random UUID, so they are safe to log.
function logStorageError(step: "upload" | "save" | "delete", key: string, error: unknown): void {
  console.error(`[store-logo] ${step} failed for ${key}:`, error instanceof Error ? error.message : error);
}
