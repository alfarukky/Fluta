import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ComingUp } from "@/types/deliveries";

import { ComingUpSection } from "./ComingUpSection";

const EMPTY: ComingUp = { days: [], waiting: null, cleaning: null, empty: true };

describe("ComingUpSection", () => {
  it("shows the empty line when there is nothing at all", () => {
    render(<ComingUpSection comingUp={EMPTY} />);
    expect(screen.getByRole("heading", { level: 2, name: "Coming up" })).toBeTruthy();
    expect(screen.getByText("Nothing coming up in the next 7 days")).toBeTruthy();
  });

  it("shows only the lines that have something to say, as plain text with no links or buttons", () => {
    render(
      <ComingUpSection
        comingUp={{
          days: [{ date: "2026-10-31", heading: "Tomorrow, Sat 31 Oct · 1 pickup", pickups: ["10:00 AM – 12:00 PM · Wuse"] }],
          waiting: null,
          cleaning: "1 order is being cleaned and will need delivery.",
          empty: false,
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Tomorrow, Sat 31 Oct · 1 pickup" })).toBeTruthy();
    expect(screen.getByText("10:00 AM – 12:00 PM · Wuse")).toBeTruthy();
    expect(screen.getByText("1 order is being cleaned and will need delivery.")).toBeTruthy();
    expect(screen.queryByText(/waiting for the store/)).toBeNull();
    expect(screen.queryByText("Nothing coming up in the next 7 days")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
