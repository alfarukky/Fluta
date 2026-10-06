import "server-only";

import QRCode, { type QRCodeErrorCorrectionLevel } from "qrcode";

// The booking-link QR code as a PNG data URL: shown on the settings page and
// downloaded as-is, so what customers scan is exactly what is shown.
export const QR_OPTIONS = {
  errorCorrectionLevel: "M" satisfies QRCodeErrorCorrectionLevel,
  margin: 4, // the quiet zone the QR standard asks for
  scale: 20, // pixels per module: large enough to print
  color: { dark: "#000000", light: "#ffffff" },
} as const;

export async function createQrCodePng(text: string): Promise<string> {
  return QRCode.toDataURL(text, { ...QR_OPTIONS, type: "image/png" });
}
