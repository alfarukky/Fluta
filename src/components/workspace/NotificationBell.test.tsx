import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTIFICATION_POLL_MS } from "@/lib/staff-notifications";
import type { NotificationItem } from "@/types/staff-notifications";

import { COUNT_URL, NotificationBell, SEEN_URL } from "./NotificationBell";

const ITEM: NotificationItem = {
  id: "n1",
  text: "New online booking from Chidi Okeke",
  orderNumber: "FF-1024",
  time: "Tue, 27 Oct 2026, 2:15 PM",
  href: "/orders/order-1",
  isNew: true,
};

let visibility: DocumentVisibilityState = "visible";
let countResponses: { status: number; count?: number }[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function countCalls(): number {
  return fetchMock.mock.calls.filter(([url]) => url === COUNT_URL).length;
}

// Lets the fetch promises and React's state updates settle.
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  countResponses = [];
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  fetchMock = vi.fn(async (url: string) => {
    if (url === SEEN_URL) return json(200, { items: [ITEM] });
    const next = countResponses.shift() ?? { status: 200, count: 0 };
    return json(next.status, next.count === undefined ? { ok: false } : { count: next.count });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NotificationBell", () => {
  it("shows the unread count, and 9+ above 9", async () => {
    countResponses = [{ status: 200, count: 3 }, { status: 200, count: 12 }];
    render(<NotificationBell />);
    await settle();
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" }).textContent).toContain("3");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS);
    });
    expect(screen.getByRole("button", { name: "Notifications, more than 9 unread" }).textContent).toContain("9+");
    expect(screen.getByRole("status").textContent).toBe("Notifications, more than 9 unread");
  });

  it("asks every 30 seconds, pauses while the tab is hidden, and asks again when it is visible", async () => {
    render(<NotificationBell />);
    await settle();
    expect(countCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS);
    });
    expect(countCalls()).toBe(2);

    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS * 3);
    });
    expect(countCalls()).toBe(2);

    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(countCalls()).toBe(3);
  });

  it("stops asking once the server refuses (signed out or access lost)", async () => {
    countResponses = [{ status: 403 }];
    render(<NotificationBell />);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS * 3);
    });
    expect(countCalls()).toBe(1);
    expect(screen.getByRole("button", { name: "Notifications, none unread" })).toBeDefined();
  });

  it("lists the notifications when opened and clears the count", async () => {
    countResponses = [{ status: 200, count: 1 }];
    render(<NotificationBell />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(SEEN_URL, expect.objectContaining({ method: "POST" }));
    const link = screen.getByRole("link", { name: /New online booking from Chidi Okeke/ });
    expect(link.getAttribute("href")).toBe("/orders/order-1");
    expect(link.textContent).toContain("FF-1024 · Tue, 27 Oct 2026, 2:15 PM");
    expect(screen.getByRole("button", { name: "Notifications, none unread" })).toBeDefined();
  });

  it("says so when there is nothing to show", async () => {
    fetchMock.mockImplementation(async (url: string) => json(200, url === SEEN_URL ? { items: [] } : { count: 0 }));
    render(<NotificationBell />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Notifications, none unread" }));
    await settle();
    expect(screen.getByText("No notifications yet")).toBeDefined();
  });
});
