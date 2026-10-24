import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UNLISTED_AREA_ID } from "@/schemas/booking";
import type { BookingOptions } from "@/types/booking";

import { EMPTY_DRAFT, type BookingDraft } from "./booking-draft";
import { PickupStep } from "./PickupStep";

const OPTIONS: BookingOptions = {
  today: "2099-06-15",
  services: [],
  dropOff: true,
  payAtBooking: false,
  pickup: true,
  areas: [{ id: "wuse", name: "Wuse 2", chargeType: "FIXED", fixedCharge: 150_000 }],
  defaultFee: null,
  dates: [{ date: "2099-06-15", windows: [{ start: "10:00", end: "12:00" }] }],
};

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const getCurrentPosition = vi.fn();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  getCurrentPosition.mockReset();
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The step with its draft kept in state, as BookingFlow keeps it. The latest
// draft is shown for the test to read.
function Harness({ options, initial = {} }: { options: BookingOptions; initial?: Partial<BookingDraft> }) {
  const [draft, setDraft] = useState<BookingDraft>({ ...EMPTY_DRAFT, fulfilmentType: "PICKUP_DELIVERY", ...initial });
  return (
    <>
      <PickupStep options={options} draft={draft} errors={{}} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />
      <output data-testid="location">{JSON.stringify(draft.location)}</output>
    </>
  );
}

describe("My area isn't listed", () => {
  it("is offered only when the store has a default fee, with ₦0 shown as Free", () => {
    const { unmount } = render(<Harness options={OPTIONS} />);
    expect(screen.queryByText("My area isn't listed")).toBeNull();
    unmount();

    render(<Harness options={{ ...OPTIONS, defaultFee: 0 }} />);
    expect(screen.getByText("My area isn't listed")).toBeTruthy();
    expect(screen.getByText("Pickup & delivery: Free")).toBeTruthy();
  });

  it("asks for the customer's area once chosen", () => {
    render(<Harness options={{ ...OPTIONS, defaultFee: 200_000 }} initial={{ areaId: UNLISTED_AREA_ID }} />);
    expect(screen.getByText("Pickup & delivery: ₦2,000")).toBeTruthy();
    expect(screen.getByLabelText("Area name")).toBeTruthy();
  });
});

describe("Use my current location", () => {
  it("never asks for the location until the button is tapped", () => {
    render(<Harness options={OPTIONS} />);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("adds the location when allowed, rounded, and Remove clears it", () => {
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 9.0812344, longitude: 7.4912336 } } as GeolocationPosition),
    );
    render(<Harness options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Use my current location" }));

    expect(screen.getByText("Location added to help find your address")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("location").textContent ?? "null")).toEqual({ latitude: 9.081234, longitude: 7.491234 });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByTestId("location").textContent).toBe("null");
    expect(screen.getByRole("button", { name: "Use my current location" })).toBeTruthy();
  });

  it("asks the customer to type their address when refused or unavailable", () => {
    getCurrentPosition.mockImplementation((_success: PositionCallback, failure: PositionErrorCallback) =>
      failure({ code: 1, message: "denied" } as GeolocationPositionError),
    );
    render(<Harness options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Use my current location" }));

    expect(screen.getByText("Couldn't get your location. Please type your address.")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("null");
    // The address field still works as normal.
    expect(screen.getByLabelText("Your address")).toBeTruthy();
  });
});
