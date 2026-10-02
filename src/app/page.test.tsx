import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Home from "@/app/page";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("renders the Fluta placeholder heading", () => {
  render(<Home />);
  expect(screen.getByText("fluta")).toBeDefined();
  expect(
    screen.getByRole("heading", { level: 1, name: "Laundry operations, made simple" }),
  ).toBeDefined();
});

test("links to the design system only in development", () => {
  vi.stubEnv("NODE_ENV", "production");
  const { unmount } = render(<Home />);
  expect(screen.queryByRole("link", { name: /design system/i })).toBeNull();
  unmount();

  vi.stubEnv("NODE_ENV", "development");
  render(<Home />);
  expect(
    screen.getByRole("link", { name: /design system/i }).getAttribute("href"),
  ).toBe("/design-system");
});
