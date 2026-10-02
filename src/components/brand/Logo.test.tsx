import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Logo } from "@/components/brand/Logo";

test("renders the fluta wordmark in the primary colour", () => {
  render(<Logo />);
  expect(screen.getByText("fluta").className).toContain("text-primary");
});
