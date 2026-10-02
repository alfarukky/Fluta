import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button } from "@/components/ui/button";

test("defaults to the primary variant at touch-target height", () => {
  render(<Button>Book a service</Button>);
  const button = screen.getByRole("button", { name: "Book a service" });
  expect(button.dataset.variant).toBe("primary");
  expect(button.className).toContain("h-11");
});

test("disabled buttons are exposed as disabled", () => {
  render(<Button disabled>Save</Button>);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
});
