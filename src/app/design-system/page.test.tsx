import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import DesignSystemPage from "@/app/design-system/page";

afterEach(() => {
  vi.unstubAllEnvs();
});

test.each(["production", "test"])("returns a 404 when NODE_ENV is %s", (env) => {
  vi.stubEnv("NODE_ENV", env);
  expect(() => DesignSystemPage()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
});

test("renders every showcase section with its own heading in development", () => {
  vi.stubEnv("NODE_ENV", "development");
  render(<DesignSystemPage />);

  expect(screen.getByRole("heading", { level: 1, name: "Design system" })).toBeDefined();
  for (const name of [
    "Typography",
    "Colour tokens",
    "Spacing and layout",
    "Radius, borders and elevation",
    "Buttons",
    "Inputs and labels",
    "Badges",
    "Cards, avatars and separators",
    "Tabs",
    "Dialogs, sheets and menus",
    "Loading, toasts and empty states",
    "Icons",
    "Responsive behaviour",
    "Product compositions",
  ]) {
    expect(screen.getByRole("region", { name })).toBeDefined();
  }
});
