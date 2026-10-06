import "server-only";

import { imageSize } from "image-size";

// Store logo rules. The type comes only from the file's first bytes: the
// file name and the Content-Type the browser claims are ignored. No SVG.
// The header check limits size; it does not prove the rest of the file is a
// valid image, so logos are only ever served from R2's own domain with the
// content type set here.

export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_MAX_DIMENSION = 2000;

export interface LogoType {
  contentType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
}

const PNG: LogoType = { contentType: "image/png", extension: "png" };
const JPEG: LogoType = { contentType: "image/jpeg", extension: "jpg" };
const WEBP: LogoType = { contentType: "image/webp", extension: "webp" };

// image-size's name for each type, to confirm it parsed the same format.
const SIZE_TYPE: Record<LogoType["extension"], string> = { png: "png", jpg: "jpg", webp: "webp" };

export type LogoFileError = "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "TOO_MANY_PIXELS" | "UNREADABLE";

export type LogoFileCheck =
  | { ok: true; type: LogoType; width: number; height: number }
  | { ok: false; error: LogoFileError };

export function detectLogoType(bytes: Uint8Array): LogoType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return JPEG;
  // "RIFF" <4-byte size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return WEBP;
  }
  return null;
}

// Size, then type from the bytes, then dimensions from the header (the image
// is never decoded).
export function checkLogoFile(bytes: Uint8Array): LogoFileCheck {
  if (bytes.length === 0) return { ok: false, error: "EMPTY" };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: "TOO_LARGE" };

  const type = detectLogoType(bytes);
  if (!type) return { ok: false, error: "UNSUPPORTED_TYPE" };

  let size: ReturnType<typeof imageSize>;
  try {
    size = imageSize(bytes);
  } catch {
    return { ok: false, error: "UNREADABLE" };
  }
  if (size.type !== SIZE_TYPE[type.extension] || !(size.width > 0) || !(size.height > 0)) {
    return { ok: false, error: "UNREADABLE" };
  }
  if (size.width > LOGO_MAX_DIMENSION || size.height > LOGO_MAX_DIMENSION) {
    return { ok: false, error: "TOO_MANY_PIXELS" };
  }
  return { ok: true, type, width: size.width, height: size.height };
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}
