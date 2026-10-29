import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StagingBanner } from "./StagingBanner";

describe("StagingBanner", () => {
  it("says the site is staging, with test data and test-mode payments", () => {
    render(<StagingBanner />);
    expect(screen.getByRole("note").textContent).toBe("Staging: test data only. Payments are in test mode.");
  });
});
