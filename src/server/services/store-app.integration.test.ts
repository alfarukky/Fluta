import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { createTestPrisma } from "@/test/integration/db";
import { FakeObjectStorage } from "@/test/fake-r2";

const fakeR2 = vi.hoisted(() => ({ storage: null as FakeObjectStorage | null }));
vi.mock("@/server/integrations/r2", () => ({ getObjectStorage: () => fakeR2.storage }));

import { GET as getIcon } from "@/app/(customer)/store/[slug]/app-icon/[id]/route";
import { GET as getManifest } from "@/app/(customer)/store/[slug]/manifest.webmanifest/route";
import { generateMetadata } from "@/app/(customer)/store/[slug]/page";
import { GET as getPreview } from "@/app/(customer)/store/[slug]/preview-image/route";

// Image rendering and Neon round trips are slow.
vi.setConfig({ testTimeout: 60_000 });

let prisma: PrismaClient;
// Yellow brand with a red PNG logo, and blue brand with a green WebP logo.
let yellow: { id: string; slug: string };
let blue: { id: string; slug: string };

beforeAll(async () => {
  fakeR2.storage = new FakeObjectStorage();
  prisma = createTestPrisma();
  yellow = await createStore("Mama Ada Laundry Services", "#FFD60A", "png", { r: 255, g: 0, b: 0 });
  blue = await createStore("Blue Wash", "#1D4ED8", "webp", { r: 0, g: 255, b: 0 });
}, 120_000);

afterAll(async () => {
  // Test cleanup only.
  await prisma.subscription.deleteMany({ where: { storeId: { in: [yellow.id, blue.id] } } });
  await prisma.store.deleteMany({ where: { id: { in: [yellow.id, blue.id] } } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function createStore(
  name: string,
  brandPrimaryColor: string,
  format: "png" | "webp",
  logoColour: { r: number; g: number; b: number },
): Promise<{ id: string; slug: string }> {
  const slug = `store-app-test-${randomUUID().slice(0, 8)}`;
  const { id } = await prisma.store.create({
    data: { name, slug, orderPrefix: "SA", brandPrimaryColor, activeDays: [], subscription: { create: { planName: "Test", priceAmount: 0 } } },
    select: { id: true },
  });
  const logoKey = `stores/${id}/logo/${randomUUID()}.${format}`;
  const image = sharp({ create: { width: 200, height: 200, channels: 3, background: logoColour } });
  // Lossless, so the logo's colour comes back exactly.
  const logo = await (format === "png" ? image.png() : image.webp({ lossless: true })).toBuffer();
  await fakeR2.storage?.put(logoKey, new Uint8Array(logo), `image/${format}`);
  await prisma.store.update({ where: { id }, data: { logoKey } });
  return { id, slug };
}

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

async function pixel(response: Response, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at], data[at + 1], data[at + 2]];
}

describe("each store's home-screen app", () => {
  it("has its own manifest: name, short name, scope, colour, and icons", async () => {
    const response = await getManifest(new Request("http://x"), params({ slug: yellow.slug }));
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    const manifest = await response.json();

    expect(manifest).toMatchObject({
      name: "Mama Ada Laundry Services",
      short_name: "Mama Ada",
      start_url: `/store/${yellow.slug}`,
      scope: `/store/${yellow.slug}`,
      display: "standalone",
      theme_color: "#FFD60A",
    });
    expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual([
      expect.stringMatching(new RegExp(`^/store/${yellow.slug}/app-icon/icon-192\\?v=`)),
      expect.stringMatching(new RegExp(`^/store/${yellow.slug}/app-icon/icon-512\\?v=`)),
      expect.stringMatching(new RegExp(`^/store/${yellow.slug}/app-icon/maskable-512\\?v=`)),
    ]);
    expect(JSON.stringify(manifest)).not.toContain("Blue Wash");
  });

  it("draws icons from the store's own logo on its own brand colour, WebP included", async () => {
    const yellowIcon = await getIcon(new Request("http://x"), params({ slug: yellow.slug, id: "icon-192" }));
    expect(yellowIcon.headers.get("content-type")).toBe("image/png");
    expect(await pixel(yellowIcon.clone(), 2, 2)).toEqual([255, 214, 10]); // brand yellow
    expect(await pixel(yellowIcon, 96, 96)).toEqual([255, 0, 0]); // red logo

    const blueIcon = await getIcon(new Request("http://x"), params({ slug: blue.slug, id: "apple-180" }));
    expect(await pixel(blueIcon.clone(), 2, 2)).toEqual([29, 78, 216]);
    expect(await pixel(blueIcon, 90, 90)).toEqual([0, 255, 0]); // the WebP logo, redrawn
  });

  it("falls back to initials when the logo can't be read", async () => {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: blue.id }, select: { logoKey: true } });
    const saved = fakeR2.storage?.objects.get(store.logoKey ?? "");
    fakeR2.storage?.objects.set(store.logoKey ?? "", { body: new Uint8Array([1, 2, 3]), contentType: "image/webp" });
    try {
      const icon = await getIcon(new Request("http://x"), params({ slug: blue.slug, id: "icon-192" }));
      expect(icon.status).toBe(200);
      expect(await pixel(icon, 96, 96)).not.toEqual([0, 255, 0]);
    } finally {
      if (saved) fakeR2.storage?.objects.set(store.logoKey ?? "", saved);
    }
  });

  it("refuses an unknown icon or store", async () => {
    expect((await getIcon(new Request("http://x"), params({ slug: yellow.slug, id: "huge" }))).status).toBe(404);
    expect((await getManifest(new Request("http://x"), params({ slug: "no-such-store" }))).status).toBe(404);
  });
});

describe("link previews", () => {
  it("carry only the store's own name, line, and image", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: yellow.slug }) } as PageProps<"/store/[slug]">);
    expect(metadata.title).toBe("Mama Ada Laundry Services");
    expect(metadata.openGraph).toMatchObject({
      title: "Mama Ada Laundry Services",
      description: "Book your laundry with Mama Ada Laundry Services",
      images: [expect.objectContaining({ url: expect.stringMatching(new RegExp(`^/store/${yellow.slug}/preview-image\\?v=`)) })],
    });

    const image = await getPreview(new Request("http://x"), params({ slug: yellow.slug }));
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(await pixel(image, 4, 4)).toEqual([255, 214, 10]);
  });

  it("show nothing about a Deactivated store", async () => {
    await prisma.store.update({ where: { id: blue.id }, data: { status: "DEACTIVATED" } });
    try {
      const metadata = await generateMetadata({ params: Promise.resolve({ slug: blue.slug }) } as PageProps<"/store/[slug]">);
      expect(metadata).toEqual({ title: "Store not available", robots: { index: false } });
      expect((await getPreview(new Request("http://x"), params({ slug: blue.slug }))).status).toBe(404);
      expect((await getManifest(new Request("http://x"), params({ slug: blue.slug }))).status).toBe(404);
      expect((await getIcon(new Request("http://x"), params({ slug: blue.slug, id: "icon-192" }))).status).toBe(404);
    } finally {
      await prisma.store.update({ where: { id: blue.id }, data: { status: "ACTIVE" } });
    }
  });
});
