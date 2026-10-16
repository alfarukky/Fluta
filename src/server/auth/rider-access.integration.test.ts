/// <reference types="vite/client" />

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { acceptInvitation } from "@/actions/invitations";
import { deactivateStaff, inviteStaff } from "@/actions/staff";
import InvitationPage from "@/app/(staff)/invite/[token]/page";
import { AccessDenied } from "@/components/auth/AccessDenied";
import type { PrismaClient } from "@/generated/prisma/client";
import { getServerEnv } from "@/lib/env";
import { hashToken } from "@/lib/tokens";
import { getPrisma } from "@/server/data/client";
import { FakeMailer } from "@/test/fake-mailer";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import { deleteTestPeople, testEmail } from "@/test/integration/users";

import { authorizeStoreMember } from "./access";
import { getHomePath } from "./session";

// Riders are refused by default: every workspace page, action, and API route
// refuses them unless it opts in, and only Deliveries does. The pages,
// actions, and routes are found by file, so new ones are checked too.

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers, cookies: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const Redirect = vi.hoisted(
  () =>
    class Redirect extends Error {
      constructor(readonly path: string) {
        super(`redirect to ${path}`);
      }
    },
);
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (path: string) => {
    throw new Redirect(path);
  },
}));
const fakeMailer = vi.hoisted(() => ({ current: undefined as FakeMailer | undefined }));
vi.mock("@/server/integrations/email", () => ({ getMailer: () => fakeMailer.current }));

vi.setConfig({ testTimeout: 120_000 });

type Loader = () => Promise<Record<string, unknown>>;

const WORKSPACE_PAGES = Object.entries(import.meta.glob("/src/app/**/page.tsx")).filter(
  ([path]) => path.includes("/(workspace)/"),
) as [string, Loader][];
const DELIVERIES_PAGE = "/src/app/(staff)/(workspace)/deliveries/page.tsx";

// Public actions (no workspace membership involved) and the Deliveries
// actions, which riders may use.
const NOT_WORKSPACE_ACTIONS = ["auth", "booking", "invitations", "tracking", "deliveries"].map(
  (name) => `/src/actions/${name}.ts`,
);
const WORKSPACE_ACTIONS = Object.entries(import.meta.glob("/src/actions/*.ts")).filter(
  ([path]) => !path.endsWith(".test.ts") && !NOT_WORKSPACE_ACTIONS.includes(path),
) as [string, Loader][];

const API_ROUTES = Object.entries(import.meta.glob("/src/app/api/v1/**/route.ts")) as [
  string,
  Loader,
][];

let prisma: PrismaClient;
let rider: Headers;
let freshFoldOrderId: string;

beforeAll(async () => {
  prisma = createTestPrisma();
  fakeMailer.current = new FakeMailer();
  rider = await signInHeaders("tayo@freshfold.example");
  const order = await prisma.order.findFirstOrThrow({
    where: { store: { slug: "freshfold-laundry" } },
    select: { id: true },
  });
  freshFoldOrderId = order.id;
}, 120_000);

afterEach(async () => {
  await deleteTestPeople(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function renderPage(load: Loader) {
  const { default: Page } = (await load()) as { default: (props: unknown) => Promise<unknown> };
  return Page({ params: Promise.resolve({ id: freshFoldOrderId }), searchParams: Promise.resolve({}) }) as Promise<{
    type: unknown;
    props: Record<string, unknown>;
  }>;
}

describe("a rider", () => {
  it("finds every workspace page and action this test checks", () => {
    expect(WORKSPACE_PAGES.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        DELIVERIES_PAGE,
        "/src/app/(staff)/(workspace)/orders/(list)/page.tsx",
        "/src/app/(staff)/(workspace)/orders/[id]/page.tsx",
        "/src/app/(staff)/(workspace)/settings/page.tsx",
        "/src/app/(staff)/(workspace)/services/page.tsx",
      ]),
    );
    expect(WORKSPACE_ACTIONS.map(([path]) => path)).toEqual(
      expect.arrayContaining(["/src/actions/order-stages.ts", "/src/actions/orders.ts", "/src/actions/services.ts"]),
    );
    expect(API_ROUTES.length).toBeGreaterThan(0);
  });

  it("gets the no-access page on every workspace page except Deliveries", async () => {
    request.headers = rider;
    for (const [path, load] of WORKSPACE_PAGES) {
      const page = await renderPage(load);
      if (path === DELIVERIES_PAGE) {
        expect(page.type, path).not.toBe(AccessDenied);
      } else {
        expect(page.type, path).toBe(AccessDenied);
        expect(page.props.reason, path).toBe("ROLE_NOT_PERMITTED");
      }
    }
  });

  it("is refused by every workspace action except the Deliveries ones", async () => {
    request.headers = rider;
    for (const [path, load] of WORKSPACE_ACTIONS) {
      for (const [name, action] of Object.entries(await load())) {
        if (typeof action !== "function") continue;
        const result = await action(form({}), form({}), form({}));
        expect(result, `${path} ${name}`).toMatchObject({ ok: false });
      }
    }
  });

  it("is refused by every API route", async () => {
    const origin = getServerEnv().BETTER_AUTH_URL;
    for (const [path, load] of API_ROUTES) {
      for (const [method, handler] of Object.entries(await load())) {
        if (typeof handler !== "function") continue;
        const headers = new Headers(rider);
        headers.set("origin", new URL(origin).origin);
        const response = (await handler(
          new Request(`${origin}/api/v1/store/logo`, { method, headers, body: method === "GET" ? null : new Blob(["x"]) }),
        )) as Response;
        expect(response.status, `${path} ${method}`).toBe(403);
      }
    }
  });

  it("lands on Deliveries after signing in; staff on Overview, admins on Admin", async () => {
    const ids = await prisma.user.findMany({
      where: { email: { in: ["tayo@freshfold.example", "kemi@freshfold.example", "ada@freshfold.example", "admin@fluta.example"] } },
      select: { id: true, email: true },
    });
    const home = async (email: string) => getHomePath(ids.find((user) => user.email === email)!.id);
    expect(await home("tayo@freshfold.example")).toBe("/deliveries");
    expect(await home("kemi@freshfold.example")).toBe("/overview");
    expect(await home("ada@freshfold.example")).toBe("/overview");
    expect(await home("admin@fluta.example")).toBe("/admin");
  });
});

describe("inviting a rider", () => {
  it("is invited by the owner, sees 'as a Rider', lands on Deliveries, and is signed out when deactivated", async () => {
    const owner = await signInHeaders("ada@freshfold.example");
    const email = testEmail("rider");

    request.headers = owner;
    const invited = await inviteStaff(form({ email, role: "RIDER" }));
    if (!invited.ok) throw new Error(invited.message);
    const token = new URL(invited.inviteUrl).pathname.split("/").at(-1)!;
    expect(await prisma.storeInvitation.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } })).toMatchObject({
      role: "RIDER",
    });
    expect(fakeMailer.current?.sent.at(-1)?.text).toContain("as a Rider.");

    const page = (await InvitationPage({ params: Promise.resolve({ token }) } as never)) as { props: { description: string } };
    expect(page.props.description).toBe("You've been invited to join FreshFold Laundry as a Rider.");

    request.headers = new Headers();
    await expect(acceptInvitation(token, form({ name: "New Rider", password: "a-good-password" }))).rejects.toMatchObject({
      path: "/deliveries",
    });

    const membership = await prisma.membership.findFirstOrThrow({ where: { user: { email } }, select: { id: true, role: true } });
    expect(membership.role).toBe("RIDER");
    const riderHeaders = await signInHeaders(email, "a-good-password");
    expect(await authorizeStoreMember(riderHeaders, { allowRider: true })).toMatchObject({ allowed: true });
    expect(await authorizeStoreMember(riderHeaders)).toMatchObject({ allowed: false, reason: "ROLE_NOT_PERMITTED" });

    request.headers = owner;
    expect(await deactivateStaff(membership.id)).toMatchObject({ ok: true });
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);
    expect(await authorizeStoreMember(riderHeaders, { allowRider: true })).toMatchObject({ allowed: false });
  });

  it("can't be invited as an owner", async () => {
    request.headers = await signInHeaders("ada@freshfold.example");
    const email = testEmail("would-be-owner");
    expect(await inviteStaff(form({ email, role: "OWNER" }))).toMatchObject({ ok: false });
    expect(await prisma.storeInvitation.count({ where: { email } })).toBe(0);
  });
});
