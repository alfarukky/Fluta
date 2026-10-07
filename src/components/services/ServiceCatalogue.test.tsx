import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogueService } from "@/types/services";

import { ServiceCatalogue } from "./ServiceCatalogue";

const actions = vi.hoisted(() => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  disableService: vi.fn(),
  enableService: vi.fn(),
}));
vi.mock("@/actions/services", () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const SHIRT: CatalogueService = {
  id: "shirt",
  name: "Shirt",
  category: "Wash & iron",
  pricingType: "PER_ITEM",
  price: 80_000,
  requiresQuote: false,
  isActive: true,
  updatedAt: new Date("2026-10-07T09:00:00Z"),
};

const later = (seconds: number) => new Date(SHIRT.updatedAt.getTime() + seconds * 1000);

// Radix's Switch and RadioGroup measure themselves; jsdom has no ResizeObserver.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ServiceCatalogue", () => {
  it("shows the empty state with an Add service action when there are no services", () => {
    render(<ServiceCatalogue services={[]} />);
    expect(screen.getByText("No services yet")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add service" }));
    expect(screen.getByRole("heading", { name: "Add service" })).toBeTruthy();
  });

  it("locks quote required on for per-kg, and leaves it on but editable when switched away", () => {
    render(<ServiceCatalogue services={[SHIRT]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add service" }));

    const quote = () => screen.getByRole("switch", { name: "Quote required" });
    expect(quote().getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("radio", { name: /Per kg/ }));
    expect(quote().getAttribute("aria-checked")).toBe("true");
    expect(quote().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Per item/ }));
    expect(quote().getAttribute("aria-checked")).toBe("true");
    expect(quote().hasAttribute("disabled")).toBe(false);
  });

  it("disables Save while a save is in progress", async () => {
    let finish: (value: unknown) => void = () => {};
    actions.createService.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ServiceCatalogue services={[SHIRT]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add service" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Service name" }), { target: { value: "Dress" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Price" }), { target: { value: "1,500" } });

    fireEvent.submit(screen.getByRole("textbox", { name: "Service name" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true));
    const sent: FormData = actions.createService.mock.calls[0][0];
    expect(Object.fromEntries(sent)).toEqual({
      name: "Dress",
      category: "",
      pricingType: "PER_ITEM",
      price: "1,500",
      requiresQuote: "",
    });

    finish({ ok: false, message: "Something went wrong" });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Something went wrong"));
  });

  it("disables a service at once and offers Undo, which re-enables it", async () => {
    actions.disableService.mockResolvedValue({
      ok: true,
      message: "Service disabled",
      service: { ...SHIRT, isActive: false, updatedAt: later(1) },
    });
    actions.enableService.mockResolvedValue({
      ok: true,
      message: "Service enabled",
      service: { ...SHIRT, updatedAt: later(2) },
    });
    // The services prop never changes here: the page's refreshed data hasn't
    // arrived, yet the row must already show what was saved.
    render(<ServiceCatalogue services={[SHIRT]} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Disable Shirt" })[0]);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(actions.disableService).toHaveBeenCalledWith("shirt");
    expect(screen.getAllByRole("button", { name: "Enable Shirt" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);

    const [message, options] = toast.success.mock.calls[0];
    expect(message).toBe("Shirt disabled");
    expect(options.action.label).toBe("Undo");
    options.action.onClick();
    await waitFor(() => expect(actions.enableService).toHaveBeenCalledWith("shirt"));
    await waitFor(() => expect(screen.queryAllByText("Inactive")).toHaveLength(0));
    expect(screen.getAllByRole("button", { name: "Disable Shirt" }).length).toBeGreaterThan(0);
  });

  it("shows a saved edit at once, before the page's data refreshes", async () => {
    actions.updateService.mockResolvedValue({
      ok: true,
      message: "Service saved",
      service: { ...SHIRT, name: "Shirt (pressed)", price: 90_000, updatedAt: later(1) },
    });
    render(<ServiceCatalogue services={[SHIRT]} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit Shirt" })[0]);
    fireEvent.submit(screen.getByRole("textbox", { name: "Service name" }).closest("form")!);
    await waitFor(() => expect(screen.getAllByText("Shirt (pressed)").length).toBeGreaterThan(0));
    expect(screen.getAllByText("₦900 / item").length).toBeGreaterThan(0);
  });
});
