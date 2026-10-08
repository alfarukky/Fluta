import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccessDenied } from "./AccessDenied";

vi.mock("@/actions/auth", () => ({ signOut: async () => {} }));

describe("AccessDenied", () => {
  it("shows the no-access page for an account with conflicting store access", () => {
    render(<AccessDenied reason="MEMBERSHIP_CONFLICT" />);
    expect(screen.getByText("You don't have access")).toBeDefined();
    expect(screen.getByText(/problem with your account's store access/)).toBeDefined();
  });
});
