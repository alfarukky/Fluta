import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Logo } from "@/components/brand/Logo";
import { PoweredByFluta } from "@/components/brand/PoweredByFluta";

const VERSIONS = [
  { variant: "full", tone: "default" },
  { variant: "symbol", tone: "default" },
  { variant: "full", tone: "reversed" },
  { variant: "symbol", tone: "reversed" },
  { variant: "full", tone: "mono" },
  { variant: "symbol", tone: "mono" },
] as const;

describe("Logo", () => {
  test.each(VERSIONS)("$variant $tone has the accessible name Fluta", ({ variant, tone }) => {
    render(<Logo variant={variant} tone={tone} />);
    expect(screen.getByRole("img", { name: "Fluta" })).toBeTruthy();
  });

  test("only the full lockup draws the wordmark", () => {
    const { container } = render(
      <>
        <Logo variant="full" />
        <Logo variant="symbol" />
      </>,
    );
    const [full, symbol] = container.querySelectorAll("svg");
    expect(full.getAttribute("viewBox")).toBe("0 0 186 64");
    expect(symbol.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(full.querySelector("g[transform]")).not.toBeNull();
    expect(symbol.querySelector("g[transform]")).toBeNull();
  });

  test("draws with theme tokens, so it follows light and dark", () => {
    const { container } = render(<Logo variant="symbol" />);
    expect(container.querySelector("rect.fill-accent")).not.toBeNull();
    expect(container.querySelectorAll("path.fill-primary")).toHaveLength(3);
  });

  test("the reversed version draws the green folds on a white square, with a white wordmark", () => {
    const { container } = render(<Logo tone="reversed" />);
    expect(container.querySelector("rect.fill-primary-foreground")).not.toBeNull();
    expect(container.querySelectorAll("path.fill-primary")).toHaveLength(3);
    expect(container.querySelector("g.stroke-primary-foreground")).not.toBeNull();
  });

  test("two single-colour logos on one page use their own masks", () => {
    const { container } = render(
      <>
        <Logo tone="mono" />
        <Logo tone="mono" />
      </>,
    );
    const ids = [...container.querySelectorAll("mask")].map((mask) => mask.id);
    expect(new Set(ids).size).toBe(2);
  });

  test("a decorative logo is hidden from assistive technology", () => {
    render(<Logo variant="symbol" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("PoweredByFluta", () => {
  test("says Powered by Fluta and links to the privacy notice", () => {
    render(<PoweredByFluta />);
    expect(screen.getByText("Powered by Fluta")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
    expect(screen.queryByRole("img")).toBeNull();
  });
});
