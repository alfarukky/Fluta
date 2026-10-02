import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  test("defaults to the neutral variant", () => {
    render(<Badge>Completed</Badge>);
    expect(screen.getByText("Completed").dataset.variant).toBe("neutral");
  });

  test.each(["success", "warning", "error", "info"] as const)(
    "%s uses its semantic status token",
    (variant) => {
      render(<Badge variant={variant}>Label</Badge>);
      expect(screen.getByText("Label").className).toContain(`text-${variant}`);
    },
  );

  test("keeps the text label when a decorative dot is shown", () => {
    render(<Badge dot>In progress</Badge>);
    const badge = screen.getByText("In progress");
    expect(badge.textContent).toBe("In progress");
    expect(badge.querySelector("[aria-hidden]")).not.toBeNull();
  });
});
