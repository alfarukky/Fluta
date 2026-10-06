import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomerBookingCard } from "./CustomerBookingCard";

const BOOKING_URL = "https://app.fluta.example/store/freshfold-laundry";
// Stands in for getBookingShare's QR code (that it encodes BOOKING_URL is
// tested in booking-link.test.ts); here we check the card uses it unchanged.
const QR_CODE_PNG = "data:image/png;base64,iVBORw0KGgo=";
const ACTIVE = { label: "Active", variant: "success" as const, description: "Your store is open for new orders." };

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderCard() {
  return render(<CustomerBookingCard bookingUrl={BOOKING_URL} qrCodePng={QR_CODE_PNG} status={ACTIVE} slug="freshfold-laundry" />);
}

describe("CustomerBookingCard", () => {
  it("copies the same link the QR code was made from", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(BOOKING_URL));
    expect(screen.getByText("app.fluta.example/store/freshfold-laundry")).toBeTruthy();
  });

  it("shows and downloads the QR code as given", () => {
    renderCard();
    const image = screen.getByRole("img", { name: "QR code for app.fluta.example/store/freshfold-laundry" });
    expect(image.getAttribute("src")).toBe(QR_CODE_PNG);

    const download = screen.getByRole("link", { name: "Download PNG" });
    expect(download.getAttribute("href")).toBe(QR_CODE_PNG);
    expect(download.getAttribute("download")).toBe("freshfold-laundry-booking-qr.png");
  });

  it("shows the store status with a text label and no Preview or Open button", () => {
    renderCard();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /preview|open/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /preview|open/i })).toBeNull();
  });

  it("never submits a surrounding form when Copy is clicked", () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    const { container } = render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
        <CustomerBookingCard bookingUrl={BOOKING_URL} qrCodePng={QR_CODE_PNG} status={ACTIVE} slug="freshfold-laundry" />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector("button")?.getAttribute("type")).toBe("button");
  });
});
