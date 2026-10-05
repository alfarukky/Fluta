import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrandColorSwatch } from "./BrandColorSwatch";

describe("BrandColorSwatch", () => {
  it("shows a valid colour as a swatch and its hex value", () => {
    const { container } = render(<BrandColorSwatch color="#1f4d3a" />);
    expect(screen.getByText("#1F4D3A")).toBeTruthy();
    expect(container.querySelector("rect")?.getAttribute("fill")).toBe("#1F4D3A");
  });

  it.each([null, "", "red", "#fff", "#1f4d3a; background:url(x)"])("shows %j as not set, without a swatch", (color) => {
    const { container } = render(<BrandColorSwatch color={color} />);
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });
});
