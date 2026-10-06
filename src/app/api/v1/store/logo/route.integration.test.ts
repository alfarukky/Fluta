import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { removeStoreLogo } from "@/actions/store-settings";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { replaceStoreLogoKey } from "@/server/data/stores";
import { FakeObjectStorage } from "@/test/fake-r2";
import { jpegBytes, pngBytes, svgBytes, webpBytes } from "@/test/images";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { POST } from "./route";

// Logos go to a fake R2, never a real bucket.
const fakeR2 = vi.hoisted(() => ({ storage: undefined as FakeObjectStorage | undefined }));
vi.mock("@/server/integrations/r2", async () => {
  const { FakeObjectStorage } = await import("@/test/fake-r2");
  fakeR2.storage = new FakeObjectStorage();
  return { getObjectStorage: () => fakeR2.storage };
});
// Wrapped so one test can make saving the key fail.
vi.mock("@/server/data/stores", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/data/stores")>();
  return { ...original, replaceStoreLogoKey: vi.fn(original.replaceStoreLogoKey) };
});
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const ORIGIN = process.env.BETTER_AUTH_URL ?? "";

let prisma: PrismaClient;
let freshFoldId: string;
let cleanWaveId: string;
let signedIn: Record<"owner" | "staff" | "cleanWaveOwner", Headers>;

function r2(): FakeObjectStorage {
  if (!fakeR2.storage) throw new Error("fake R2 not created");
  return fakeR2.storage;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  freshFoldId = (await prisma.store.findUniqueOrThrow({ where: { slug: "freshfold-laundry" } })).id;
  cleanWaveId = (await prisma.store.findUniqueOrThrow({ where: { slug: "cleanwave-laundry" } })).id;
  signedIn = {
    owner: await signInHeaders("ada@freshfold.example"),
    staff: await signInHeaders("kemi@freshfold.example"),
    cleanWaveOwner: await signInHeaders("musa@cleanwave.example"),
  };
});

afterEach(async () => {
  await prisma.store.updateMany({ where: { id: { in: [freshFoldId, cleanWaveId] } }, data: { logoKey: null } });
  r2().reset();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

function upload(
  body: Uint8Array,
  as: Headers,
  extraHeaders: Record<string, string> = {},
  url = `${ORIGIN}/api/v1/store/logo`,
): Promise<Response> {
  const headers = new Headers(as);
  headers.set("origin", ORIGIN);
  // The claimed type is ignored; the bytes decide.
  headers.set("content-type", "image/png");
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return POST(new Request(url, { method: "POST", headers, body: new Blob([body.slice()]) }));
}

async function logoKey(storeId = freshFoldId): Promise<string | null> {
  return (await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { logoKey: true } })).logoKey;
}

describe("POST /api/v1/store/logo", () => {
  it("stores a valid logo under a Fluta-generated key with the type from its bytes", async () => {
    const response = await upload(webpBytes(800, 400), signedIn.owner);
    expect(response.status).toBe(200);
    const key = await logoKey();
    expect(key).toMatch(new RegExp(`^stores/${freshFoldId}/logo/[0-9a-f-]{36}\\.webp$`));
    expect(r2().objects.get(key ?? "")?.contentType).toBe("image/webp");
    expect(await response.json()).toEqual({ ok: true, logoUrl: expect.stringMatching(/^https:\/\/.+\.webp$/) });
  });

  it.each([
    ["an oversized file", pngBytes(100, 100, 1024 * 1024 + 1), 413],
    ["an SVG", svgBytes(), 415],
    ["a text file named like a PNG", new TextEncoder().encode("not really a png"), 415],
    ["an image over 2000 pixels", jpegBytes(2001, 1000), 422],
  ])("rejects %s and stores nothing", async (_name, body, status) => {
    const response = await upload(body, signedIn.owner);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ ok: false, message: expect.any(String) });
    expect(r2().objects.size).toBe(0);
    expect(await logoKey()).toBeNull();
  });

  it("refuses a declared oversized body before reading it", async () => {
    const response = await upload(pngBytes(10, 10), signedIn.owner, { "content-length": String(5 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect(r2().objects.size).toBe(0);
  });

  it("refuses staff, other sites, and anonymous requests", async () => {
    expect((await upload(pngBytes(10, 10), signedIn.staff)).status).toBe(403);
    expect((await upload(pngBytes(10, 10), signedIn.owner, { origin: "https://evil.example" })).status).toBe(403);
    expect((await upload(pngBytes(10, 10), new Headers())).status).toBe(401);
    expect(r2().objects.size).toBe(0);
    expect(await logoKey()).toBeNull();
  });

  it("replacing a logo saves the new key and deletes the old file", async () => {
    await upload(pngBytes(100, 100), signedIn.owner);
    const oldKey = await logoKey();
    await upload(jpegBytes(200, 200), signedIn.owner);
    const newKey = await logoKey();
    expect(newKey).not.toBe(oldKey);
    expect([...r2().objects.keys()]).toEqual([newKey]);
  });

  it("a failed delete of the old file is logged, not reported as a failed save", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await upload(pngBytes(100, 100), signedIn.owner);
    const oldKey = await logoKey();
    r2().failDeletes = true;
    const response = await upload(pngBytes(100, 100), signedIn.owner);
    expect(response.status).toBe(200);
    expect(await logoKey()).not.toBe(oldKey);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`delete failed for ${oldKey}`), expect.anything());
  });

  it("a failed save leaves no uploaded file behind", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(replaceStoreLogoKey).mockRejectedValueOnce(new Error("database unavailable"));
    const response = await upload(pngBytes(100, 100), signedIn.owner);
    expect(response.status).toBe(500);
    expect(r2().objects.size).toBe(0);
    expect(await logoKey()).toBeNull();
  });

  it("a failed upload saves nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    r2().failPuts = true;
    expect((await upload(pngBytes(100, 100), signedIn.owner)).status).toBe(502);
    expect(await logoKey()).toBeNull();
  });
});

describe("removeStoreLogo", () => {
  it("clears logoKey, then deletes the file", async () => {
    await upload(pngBytes(100, 100), signedIn.owner);
    expect(r2().objects.size).toBe(1);
    request.headers = signedIn.owner;
    expect(await removeStoreLogo()).toMatchObject({ ok: true });
    expect(await logoKey()).toBeNull();
    expect(r2().objects.size).toBe(0);
  });

  it("refuses staff and keeps the logo", async () => {
    await upload(pngBytes(100, 100), signedIn.owner);
    const key = await logoKey();
    request.headers = signedIn.staff;
    expect(await removeStoreLogo()).toMatchObject({ ok: false });
    expect(await logoKey()).toBe(key);
    expect(r2().objects.size).toBe(1);
  });
});

describe("store isolation", () => {
  it("a CleanWave owner's upload only ever changes CleanWave, whatever the request names", async () => {
    await upload(pngBytes(100, 100), signedIn.owner);
    const freshFoldKey = await logoKey();

    const response = await upload(
      pngBytes(100, 100),
      signedIn.cleanWaveOwner,
      { "x-store-id": freshFoldId, cookie: `${signedIn.cleanWaveOwner.get("cookie")}; storeId=${freshFoldId}` },
      `${ORIGIN}/api/v1/store/logo?storeId=${freshFoldId}`,
    );
    expect(response.status).toBe(200);
    expect(await logoKey(cleanWaveId)).toMatch(new RegExp(`^stores/${cleanWaveId}/logo/`));
    expect(await logoKey()).toBe(freshFoldKey);
    expect(r2().objects.has(freshFoldKey ?? "")).toBe(true);
  });

  it("a CleanWave owner removing their logo never touches FreshFold's", async () => {
    await upload(pngBytes(100, 100), signedIn.owner);
    const freshFoldKey = await logoKey();
    await upload(pngBytes(100, 100), signedIn.cleanWaveOwner);

    request.headers = signedIn.cleanWaveOwner;
    expect(await removeStoreLogo()).toMatchObject({ ok: true });
    expect(await logoKey(cleanWaveId)).toBeNull();
    expect(await logoKey()).toBe(freshFoldKey);
    expect([...r2().objects.keys()]).toEqual([freshFoldKey]);
  });
});
