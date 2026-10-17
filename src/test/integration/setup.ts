import { vi } from "vitest";

// Integration tests never call Termii or Resend: every message the app sends
// goes to these fakes (src/test/integration/fakes.ts).
vi.mock("@/server/integrations/sms", async () => {
  const { fakeSms } = await import("./fakes");
  return { getSmsProvider: () => fakeSms };
});
vi.mock("@/server/integrations/email", async () => {
  const { fakeMailer } = await import("./fakes");
  return { getMailer: () => fakeMailer };
});
