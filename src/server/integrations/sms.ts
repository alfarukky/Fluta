import "server-only";

import { getTermiiConfig } from "@/lib/env";

import { createTermiiProvider } from "./termii";

// Fluta's SMS sender. Termii when it is configured. Otherwise (development
// only: production refuses to start without it) a provider that marks
// messages as sent without sending or printing them. Tests replace it with
// the fake in src/test/fake-sms.ts.

export interface SmsMessage {
  // E.164.
  to: string;
  text: string;
}

export interface SmsProvider {
  // Throws when the provider refuses or can't be reached.
  send(message: SmsMessage): Promise<{ providerMessageId: string | null }>;
}

let provider: SmsProvider | undefined;

export function getSmsProvider(): SmsProvider {
  provider ??= createProvider();
  return provider;
}

function createProvider(): SmsProvider {
  const config = getTermiiConfig();
  if (config) return createTermiiProvider(config);
  return { send: async () => ({ providerMessageId: null }) };
}
