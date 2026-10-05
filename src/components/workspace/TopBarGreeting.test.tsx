import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GREETING_REFRESH_MS, TopBarGreeting } from "./TopBarGreeting";

describe("TopBarGreeting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderAt(iso: string) {
    vi.setSystemTime(new Date(iso));
    render(
      <TopBarGreeting
        timeZone="Africa/Lagos"
        firstName="Ada"
        serverDate="Sunday, 4 October 2026"
        serverGreeting="Good evening"
      />,
    );
  }

  it("shows the current date and greeting in the store's time zone", () => {
    renderAt("2026-10-05T08:00:00Z"); // 09:00 in Lagos
    expect(screen.getByText("Monday, 5 October 2026")).toBeTruthy();
    expect(screen.getByText("Good morning, Ada")).toBeTruthy();
  });

  it("updates as the day goes on", () => {
    renderAt("2026-10-05T10:58:00Z"); // 11:58 in Lagos
    expect(screen.getByText("Good morning, Ada")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(GREETING_REFRESH_MS);
    });
    expect(screen.getByText("Good afternoon, Ada")).toBeTruthy();
  });

  it("moves to the next day for a tab left open overnight", () => {
    renderAt("2026-10-05T22:58:00Z"); // 23:58 in Lagos
    expect(screen.getByText("Monday, 5 October 2026")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(GREETING_REFRESH_MS);
    });
    expect(screen.getByText("Tuesday, 6 October 2026")).toBeTruthy();
    expect(screen.getByText("Good morning, Ada")).toBeTruthy();
  });

  it("re-reads the clock when the tab is shown again", () => {
    renderAt("2026-10-05T15:00:00Z"); // 16:00 in Lagos
    expect(screen.getByText("Good afternoon, Ada")).toBeTruthy();

    vi.setSystemTime(new Date("2026-10-05T17:00:00Z")); // 18:00, before the next tick
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByText("Good evening, Ada")).toBeTruthy();
  });
});
