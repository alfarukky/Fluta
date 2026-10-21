import { vi } from "vitest";

// Integration tests never call Termii, Resend, or Paystack: every message the
// app sends, and every Paystack call, goes to these fakes
// (src/test/integration/fakes.ts). The signature check stays real.
vi.mock("@/server/integrations/sms", async () => {
  const { fakeSms } = await import("./fakes");
  return { getSmsProvider: () => fakeSms };
});
vi.mock("@/server/integrations/email", async () => {
  const { fakeMailer } = await import("./fakes");
  return { getMailer: () => fakeMailer };
});
vi.mock("@/server/integrations/paystack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/integrations/paystack")>();
  const { fakePaystack } = await import("./fakes");
  return { ...actual, getPaystackClient: () => fakePaystack, createPaystackClient: () => fakePaystack };
});
