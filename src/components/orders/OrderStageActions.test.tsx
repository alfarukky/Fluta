import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AvailableTransitions } from "@/types/orders";

import { OrderStageActions } from "./OrderStageActions";

const actions = vi.hoisted(() => ({ changeOrderStage: vi.fn() }));
vi.mock("@/actions/order-stages", () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

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

const PICKUP_READY: AvailableTransitions = {
  primary: { kind: "ADVANCE", to: "OUT_FOR_DELIVERY", collectedByCustomer: false, noteRequired: false },
  secondary: [
    { kind: "COLLECTED_INSTEAD", to: "COMPLETED", collectedByCustomer: true, noteRequired: true },
    { kind: "STEP_BACK", to: "IN_PROGRESS", collectedByCustomer: false, noteRequired: true },
    { kind: "CANCEL", to: "CANCELLED", collectedByCustomer: false, noteRequired: false },
  ],
  blockedReason: null,
};

function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
}

describe("OrderStageActions", () => {
  it("shows the main move and the others in a menu", () => {
    render(<OrderStageActions orderId="o1" stage="READY" fulfilmentType="PICKUP_DELIVERY" moves={PICKUP_READY} />);
    expect(screen.getByRole("button", { name: "Out for delivery" })).toBeTruthy();
    openMenu();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Customer collected instead",
      "Step back",
      "Cancel order",
    ]);
  });

  it("moves straight away when no note is needed", async () => {
    actions.changeOrderStage.mockResolvedValue({ ok: true, message: "Order moved to Out for delivery" });
    render(<OrderStageActions orderId="o1" stage="READY" fulfilmentType="PICKUP_DELIVERY" moves={PICKUP_READY} />);
    fireEvent.click(screen.getByRole("button", { name: "Out for delivery" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order moved to Out for delivery"));
    expect(actions.changeOrderStage).toHaveBeenCalledWith({
      orderId: "o1",
      from: "READY",
      to: "OUT_FOR_DELIVERY",
      collectedByCustomer: false,
      note: null,
    });
  });

  it("asks for a note before Customer collected instead", async () => {
    actions.changeOrderStage.mockResolvedValue({ ok: false, code: "CONFLICT", message: "This order was just updated." });
    render(<OrderStageActions orderId="o1" stage="READY" fulfilmentType="PICKUP_DELIVERY" moves={PICKUP_READY} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Customer collected instead" }));

    fireEvent.click(screen.getByRole("button", { name: "Mark completed" }));
    expect(screen.getByText("Add a note to explain this change.")).toBeTruthy();
    expect(actions.changeOrderStage).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "  Collected by her brother  " } });
    fireEvent.click(screen.getByRole("button", { name: "Mark completed" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This order was just updated."));
    expect(actions.changeOrderStage).toHaveBeenCalledWith(
      expect.objectContaining({ to: "COMPLETED", collectedByCustomer: true, note: "Collected by her brother" }),
    );
  });

  it("confirms before cancelling, with an optional note when none is required", async () => {
    actions.changeOrderStage.mockResolvedValue({ ok: true, message: "Order cancelled" });
    render(<OrderStageActions orderId="o1" stage="READY" fulfilmentType="PICKUP_DELIVERY" moves={PICKUP_READY} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancel order" }));

    expect(screen.getByRole("heading", { name: "Cancel this order?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order cancelled"));
    expect(actions.changeOrderStage).toHaveBeenCalledWith(expect.objectContaining({ to: "CANCELLED", note: null }));
  });

  it("says why the main move isn't available", () => {
    render(
      <OrderStageActions
        orderId="o1"
        stage="RECEIVED_BY_STORE"
        fulfilmentType="DROP_OFF"
        moves={{ primary: null, secondary: [], blockedReason: "Waiting for the quote to be approved." }}
      />,
    );
    expect(screen.getByText("Waiting for the quote to be approved.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
