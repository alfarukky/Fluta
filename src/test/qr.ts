import { inflateSync } from "node:zlib";

import QRCode from "qrcode";
import { expect } from "vitest";

import { QR_OPTIONS } from "@/lib/qr-code";

// Reads back what a QR code PNG really contains, for tests: its module grid,
// compared with the grid QRCode's own encoder produces for the expected text.

// The dark/light module grid QRCode's own encoder produces for `text`.
export function expectedModules(text: string): boolean[][] {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: QR_OPTIONS.errorCorrectionLevel });
  return Array.from({ length: modules.size }, (_, row) =>
    Array.from({ length: modules.size }, (_, col) => Boolean(modules.get(row, col))),
  );
}

// Samples the centre of each module in the rendered PNG.
export function readModules(image: DecodedPng): boolean[][] {
  const { scale, margin } = QR_OPTIONS;
  const size = image.width / scale - margin * 2;
  expect(Number.isInteger(size)).toBe(true);
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const x = Math.floor((col + margin + 0.5) * scale);
      const y = Math.floor((row + margin + 0.5) * scale);
      return image.pixel(x, y) < 128;
    }),
  );
}

export interface DecodedPng {
  width: number;
  height: number;
  // Red channel at (x, y): 0 for dark modules, 255 for light.
  pixel(x: number, y: number): number;
}

// A small PNG reader (8-bit RGBA or RGB, not interlaced), enough to check what
// the QR image really contains with Node's own zlib.
export function decodePng(dataUrl: string): DecodedPng {
  expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8); // bit depth
      expect(data[12]).toBe(0); // not interlaced
      channels = { 2: 3, 6: 4 }[data[9]] ?? 0;
      expect(channels).toBeGreaterThan(0);
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i];
      const left = i >= channels ? pixels[y * stride + i - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
      pixels[y * stride + i] = (value + unfilter(filter, left, up, upLeft)) & 0xff;
    }
  }
  return { width, height, pixel: (x, y) => pixels[y * stride + x * channels] };
}

function unfilter(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4: {
      const p = left + up - upLeft;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
      return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
    }
    default:
      throw new Error(`Unknown PNG filter ${filter}`);
  }
}
