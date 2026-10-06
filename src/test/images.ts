// Minimal image files for upload tests: just enough header for the type and
// dimension checks (they are never decoded), plus optional padding to reach a
// given size.

export function pngBytes(width: number, height: number, padTo = 0): Uint8Array {
  const header = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR, length 13
    ...uint32BE(width), ...uint32BE(height),
    0x08, 0x06, 0x00, 0x00, 0x00, // 8-bit RGBA
    0x00, 0x00, 0x00, 0x00, // CRC (not checked)
  ];
  return pad(header, padTo);
}

export function jpegBytes(width: number, height: number, padTo = 0): Uint8Array {
  const header = [
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 JFIF
    0xff, 0xc0, 0x00, 0x11, 0x08, ...uint16BE(height), ...uint16BE(width), // SOF0
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ];
  return pad(header, padTo);
}

export function webpBytes(width: number, height: number, padTo = 0): Uint8Array {
  const header = [
    0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, // RIFF … WEBP
    0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, // VP8X, chunk length 10
    0x00, 0x00, 0x00, 0x00, // flags
    ...uint24LE(width - 1), ...uint24LE(height - 1),
  ];
  return pad(header, padTo);
}

export function svgBytes(): Uint8Array {
  return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
}

function pad(header: number[], padTo: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(header.length, padTo));
  bytes.set(header);
  return bytes;
}

function uint32BE(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function uint16BE(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function uint24LE(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
}
