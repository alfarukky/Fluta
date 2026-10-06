// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decodePng, expectedModules, readModules } from "@/test/qr";

import { createQrCodePng } from "./qr-code";

const URL_A = "https://fluta.app/store/freshfold-laundry";
const URL_B = "https://fluta.app/store/cleanwave-laundry";

describe("createQrCodePng", () => {
  it("draws exactly the QR code for the given link", async () => {
    const image = decodePng(await createQrCodePng(URL_A));
    expect(readModules(image)).toEqual(expectedModules(URL_A));
  });

  it("draws a different code for a different link", async () => {
    const image = decodePng(await createQrCodePng(URL_A));
    expect(readModules(image)).not.toEqual(expectedModules(URL_B));
  });
});
