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

test("subtle row actions have a border and fill at rest, and only Disable warns on hover", () => {
  render(
    <>
      <Button variant="subtle" size="sm">Edit</Button>
      <Button variant="subtle-destructive" size="sm">Disable</Button>
    </>,
  );
  const edit = screen.getByRole("button", { name: "Edit" }).className;
  const disable = screen.getByRole("button", { name: "Disable" }).className;
  for (const className of [edit, disable]) {
    expect(className).toContain("border-input");
    expect(className).toContain("bg-muted");
    expect(className).toContain("focus-visible:ring-ring");
  }
  expect(edit).not.toContain("hover:text-error");
  expect(disable).toContain("hover:text-error");
});
