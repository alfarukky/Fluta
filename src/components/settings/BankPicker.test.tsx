import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { BankPicker, filterBanks } from "./BankPicker";

const BANKS = [
  { id: "1", name: "Access Bank" },
  { id: "9", name: "Guaranty Trust Bank" },
  { id: "690", name: "U&C Microfinance Bank Ltd (U AND C MFB)" },
  { id: "635", name: "Goodnews Microfinance Bank" },
  { id: "792", name: "Prospa Capital Microfinance Bank" },
];

describe("filterBanks", () => {
  it("keeps every bank for an empty search", () => {
    expect(filterBanks(BANKS, "  ")).toHaveLength(BANKS.length);
  });

  it("matches part of the name, ignoring case and punctuation", () => {
    expect(filterBanks(BANKS, "trust").map((bank) => bank.id)).toEqual(["9"]);
    expect(filterBanks(BANKS, "u&c").map((bank) => bank.id)).toEqual(["690"]);
    expect(filterBanks(BANKS, "MICROFINANCE").map((bank) => bank.id)).toEqual(["690", "635", "792"]);
  });

  it("matches the initials: gtb finds Guaranty Trust Bank", () => {
    expect(filterBanks(BANKS, "gtb").map((bank) => bank.id)).toEqual(["9"]);
    expect(filterBanks(BANKS, "GT").map((bank) => bank.id)).toEqual(["9"]);
  });

  it("finds nothing for an unknown bank", () => {
    expect(filterBanks(BANKS, "zenith")).toEqual([]);
  });
});

function Picker() {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="bank">Bank</label>
      <BankPicker id="bank" banks={BANKS} value={value} onChange={setValue} />
      <output>{value}</output>
    </>
  );
}

describe("BankPicker", () => {
  it("filters as you type and chooses a bank by clicking it", () => {
    render(<Picker />);
    const trigger = screen.getByRole("combobox", { name: "Bank" });
    expect(trigger.textContent).toContain("Choose your bank");

    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search banks" }), { target: { value: "prospa" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Prospa Capital Microfinance Bank"]);

    fireEvent.click(screen.getByRole("option", { name: "Prospa Capital Microfinance Bank" }));
    expect(screen.getByRole("status").textContent).toBe("792");
    expect(screen.getByRole("combobox", { name: "Bank" }).textContent).toContain("Prospa Capital Microfinance Bank");
  });

  it("chooses with the arrow keys and Enter", () => {
    render(<Picker />);
    fireEvent.click(screen.getByRole("combobox", { name: "Bank" }));
    const search = screen.getByRole("searchbox", { name: "Search banks" });
    fireEvent.change(search, { target: { value: "microfinance" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("status").textContent).toBe("635");
  });

  it("says so when no bank matches", () => {
    render(<Picker />);
    fireEvent.click(screen.getByRole("combobox", { name: "Bank" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search banks" }), { target: { value: "zenith" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No bank matches “zenith”.")).toBeTruthy();
  });
});
