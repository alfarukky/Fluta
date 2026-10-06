import { getServerEnv } from "@/lib/env";
import { readBodyWithLimit } from "@/lib/read-body";
import { authorizeStoreMember } from "@/server/auth/access";
import { LOGO_MAX_BYTES } from "@/server/domain/logo-file";
import { uploadStoreLogo, type LogoUploadResult } from "@/server/services/store-settings";

type UploadError = Extract<LogoUploadResult, { ok: false }>["error"];

const ERRORS: Record<UploadError, { status: number; message: string }> = {
  EMPTY: { status: 422, message: "Choose an image to upload." },
  TOO_LARGE: { status: 413, message: "Your logo must be 1 MB or smaller." },
  UNSUPPORTED_TYPE: { status: 415, message: "Use a PNG, JPEG or WebP image. SVG isn't supported." },
  TOO_MANY_PIXELS: { status: 422, message: "Your logo must be 2000 × 2000 pixels or smaller." },
  UNREADABLE: { status: 422, message: "We couldn't read this image. Save it again as PNG, JPEG or WebP and retry." },
  UPLOAD_FAILED: { status: 502, message: "We couldn't save your logo. Please try again." },
  SAVE_FAILED: { status: 500, message: "We couldn't save your logo. Please try again." },
};

// Upload or replace the store logo (owner only). The body is the raw file;
// its type comes from its bytes, never from the Content-Type header or name.
// The store is the caller's own, from their membership.
export async function POST(request: Request): Promise<Response> {
  // Route handlers get no CSRF protection from Next.js, so only the app's own
  // pages may post here.
  if (request.headers.get("origin") !== new URL(getServerEnv().BETTER_AUTH_URL).origin) {
    return Response.json({ ok: false, message: "This request isn't allowed." }, { status: 403 });
  }

  const member = await authorizeStoreMember(request.headers, { role: "OWNER" });
  if (!member.allowed) {
    const message = member.status === 401 ? "Sign in again to continue." : "Only the store owner can change the logo.";
    return Response.json({ ok: false, message }, { status: member.status });
  }

  const body = await readBodyWithLimit(request, LOGO_MAX_BYTES);
  if (!body.ok) return errorResponse(body.error);

  const result = await uploadStoreLogo(member.store.id, body.bytes);
  if (!result.ok) return errorResponse(result.error);
  return Response.json({ ok: true, logoUrl: result.logoUrl });
}

function errorResponse(error: UploadError): Response {
  const { status, message } = ERRORS[error];
  return Response.json({ ok: false, message }, { status });
}
