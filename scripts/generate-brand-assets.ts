// Writes Fluta's logo files into public/ from the shared geometry in
// src/components/brand/logo-art.ts. Run after changing the logo, then commit
// the output:  npx tsx scripts/generate-brand-assets.ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { BRAND_COLOURS, renderLogoSvg } from "../src/components/brand/logo-art";

const PUBLIC = path.join(import.meta.dirname, "..", "public");
const BRAND = path.join(PUBLIC, "brand");

const svgs = {
  "fluta-logo.svg": renderLogoSvg({ variant: "full", colours: BRAND_COLOURS.default }),
  "fluta-symbol.svg": renderLogoSvg({ variant: "symbol", colours: BRAND_COLOURS.default }),
  "fluta-logo-reversed.svg": renderLogoSvg({ variant: "full", colours: BRAND_COLOURS.reversed }),
  "fluta-symbol-reversed.svg": renderLogoSvg({ variant: "symbol", colours: BRAND_COLOURS.reversed }),
  "fluta-logo-black.svg": renderLogoSvg({ variant: "full", colours: { mono: "#000000" } }),
  "fluta-symbol-black.svg": renderLogoSvg({ variant: "symbol", colours: { mono: "#000000" } }),
};

function png(svg: string, width: number, height = width, background?: string): Promise<Buffer> {
  // A high density so small sizes are drawn from a sharp rendering.
  let image = sharp(Buffer.from(svg), { density: 1200 }).resize(width, height);
  if (background) image = image.flatten({ background });
  return image.png().toBuffer();
}

// An .ico holding PNG images (supported by every current browser).
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

async function main() {
  await mkdir(BRAND, { recursive: true });
  for (const [name, svg] of Object.entries(svgs)) await writeFile(path.join(BRAND, name), svg);

  const symbol = svgs["fluta-symbol.svg"];
  // Emails show it at 93 × 32; drawn at three times that for sharp screens.
  await writeFile(path.join(BRAND, "fluta-logo-email.png"), await png(svgs["fluta-logo.svg"], 279, 96));

  await writeFile(path.join(PUBLIC, "icon.svg"), symbol);
  await writeFile(
    path.join(PUBLIC, "favicon.ico"),
    ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(symbol, size) })))),
  );
  await writeFile(path.join(PUBLIC, "icon-192.png"), await png(symbol, 192));
  await writeFile(path.join(PUBLIC, "icon-512.png"), await png(symbol, 512));
  // Home screens round the corners themselves, so the square fills the image.
  await writeFile(path.join(PUBLIC, "apple-touch-icon.png"), await png(symbol, 180, 180, BRAND_COLOURS.default.square));
}

await main();
