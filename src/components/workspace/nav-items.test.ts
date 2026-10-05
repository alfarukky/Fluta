import { describe, expect, it } from "vitest";

import { getNavItem, getNavItems, isNavItemActive, NAV_ITEMS, type NavHref } from "./nav-items";

describe("getNavItems", () => {
  it("gives owners every workspace page", () => {
    expect(getNavItems("OWNER").map((item) => item.label)).toEqual([
      "Overview",
      "Orders",
      "Customers",
      "Payments",
      "Services",
      "Fulfilment",
      "Reports",
      "Settings",
    ]);
  });

  it("gives staff only the day-to-day pages", () => {
    expect(getNavItems("STAFF").map((item) => item.label)).toEqual(["Overview", "Orders", "Customers", "Payments"]);
  });
});

describe("isNavItemActive", () => {
  const orders = { href: "/orders" };

  it("matches the page and its sub-pages", () => {
    expect(isNavItemActive(orders, "/orders")).toBe(true);
    expect(isNavItemActive(orders, "/orders/FF-1042")).toBe(true);
  });

  it("doesn't match a page that only shares a prefix", () => {
    expect(isNavItemActive(orders, "/orders-archive")).toBe(false);
    expect(isNavItemActive(orders, "/overview")).toBe(false);
  });
});

describe("getNavItem", () => {
  it("returns the item for a navigation path", () => {
    expect(getNavItem("/reports")).toMatchObject({ href: "/reports", label: "Reports", roles: ["OWNER"] });
  });

  // Checked by `npm run typecheck`: it fails if "/invoices" stops being an error.
  it("only accepts paths that are in the navigation", () => {
    // @ts-expect-error "/invoices" isn't a navigation path.
    const notInNav: NavHref = "/invoices";
    expect(NAV_ITEMS.map((item) => item.href)).not.toContain(notInNav);
  });
});
