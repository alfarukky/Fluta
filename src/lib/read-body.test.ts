// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readBodyWithLimit } from "./read-body";

function streamOf(chunks: Uint8Array[], onPull?: () => void): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      onPull?.();
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/upload", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

describe("readBodyWithLimit", () => {
  it("returns the whole body when it is within the limit", async () => {
    const result = await readBodyWithLimit(post(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])])), 3);
    expect(result).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
  });

  it("refuses a declared Content-Length over the limit without reading", async () => {
    let pulls = 0;
    const request = post(
      streamOf([new Uint8Array(10)], () => pulls++),
      { "content-length": "11" },
    );
    expect(await readBodyWithLimit(request, 10)).toEqual({ ok: false, error: "TOO_LARGE" });
    expect(pulls).toBeLessThanOrEqual(1);
  });

  it("stops reading as soon as an undeclared body goes over the limit", async () => {
    let pulls = 0;
    const chunks = Array.from({ length: 100 }, () => new Uint8Array(4));
    expect(await readBodyWithLimit(post(streamOf(chunks, () => pulls++)), 10)).toEqual({ ok: false, error: "TOO_LARGE" });
    expect(pulls).toBeLessThan(10);
  });

  it("treats a missing or empty body as empty", async () => {
    expect(await readBodyWithLimit(post(null), 10)).toEqual({ ok: false, error: "EMPTY" });
    expect(await readBodyWithLimit(post(new Uint8Array()), 10)).toEqual({ ok: false, error: "EMPTY" });
  });
});
