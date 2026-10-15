import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { QuantityStepper, stepQuantity } from "./QuantityStepper";

describe("stepQuantity", () => {
  it("adds and takes away one, within 1 to 999", () => {
    expect(stepQuantity("2", 1)).toBe("3");
    expect(stepQuantity("2", -1)).toBe("1");
    expect(stepQuantity("1", -1)).toBe("1");
    expect(stepQuantity("999", 1)).toBe("999");
  });

  it("brings a typed number outside the limits back within them", () => {
    expect(stepQuantity("1500", -1)).toBe("999");
    expect(stepQuantity("0", 1)).toBe("1");
  });

  it("starts at 1 from an empty or unreadable box", () => {
    expect(stepQuantity("", 1)).toBe("1");
    expect(stepQuantity("", -1)).toBe("1");
    expect(stepQuantity("2.5", 1)).toBe("1");
  });
});

function Controlled({ initial, onChange }: { initial: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <QuantityStepper
      id="qty"
      label="how many Shirt"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("QuantityStepper", () => {
  const minus = () => screen.getByRole("button", { name: "Decrease how many Shirt" });
  const plus = () => screen.getByRole("button", { name: "Increase how many Shirt" });
  const box = () => screen.getByRole("textbox");

  it("has buttons at the 44px touch-target size", () => {
    render(<Controlled initial="1" />);
    expect(minus().className).toContain("size-11");
    expect(plus().className).toContain("size-11");
  });

  it("disables − at 1, because Remove takes an item off", () => {
    render(<Controlled initial="1" />);
    expect(minus()).toHaveProperty("disabled", true);
    expect(plus()).toHaveProperty("disabled", false);
    fireEvent.click(plus());
    expect(box()).toHaveProperty("value", "2");
    expect(minus()).toHaveProperty("disabled", false);
    fireEvent.click(minus());
    expect(box()).toHaveProperty("value", "1");
    expect(minus()).toHaveProperty("disabled", true);
  });

  it("disables + at 999", () => {
    render(<Controlled initial="998" />);
    fireEvent.click(plus());
    expect(box()).toHaveProperty("value", "999");
    expect(plus()).toHaveProperty("disabled", true);
  });

  it("still takes a typed number, as typed", () => {
    const onChange = vi.fn();
    render(<Controlled initial="1" onChange={onChange} />);
    fireEvent.change(box(), { target: { value: "250" } });
    expect(onChange).toHaveBeenLastCalledWith("250");
    expect(box()).toHaveProperty("value", "250");
    expect(box().getAttribute("inputmode")).toBe("numeric");
    // Out of range is left for the form's check to report; − brings it back.
    fireEvent.change(box(), { target: { value: "1500" } });
    expect(plus()).toHaveProperty("disabled", true);
    fireEvent.click(minus());
    expect(box()).toHaveProperty("value", "999");
  });
});
