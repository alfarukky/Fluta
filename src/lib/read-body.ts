// Reads a request body up to `maxBytes` and stops as soon as it goes over, so
// an oversized upload is never read in full. A Content-Length over the limit
// is refused before reading anything; the stream is still counted, because the
// header can be missing or wrong.
export type BodyReadResult = { ok: true; bytes: Uint8Array } | { ok: false; error: "TOO_LARGE" | "EMPTY" };

export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<BodyReadResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await request.body?.cancel();
    return { ok: false, error: "TOO_LARGE" };
  }
  if (!request.body) return { ok: false, error: "EMPTY" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, error: "TOO_LARGE" };
    }
    chunks.push(value);
  }
  if (total === 0) return { ok: false, error: "EMPTY" };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
