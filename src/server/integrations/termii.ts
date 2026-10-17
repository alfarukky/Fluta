import "server-only";

import { z } from "zod";

import type { TermiiConfig } from "@/lib/env";

import type { SmsMessage, SmsProvider } from "./sms";

// Termii's messaging API: the only module that calls Termii. One registered
// Fluta sender name, on the "dnd" (transactional) route so messages reach
// numbers on Nigeria's Do-Not-Disturb list. Termii has no per-message
// reference that prevents duplicates, so none is sent.

const REQUEST_TIMEOUT_MS = 15_000;

const sendResponseSchema = z.object({
  message_id: z.union([z.string(), z.number()]).transform(String),
});

// Thrown for any failed send. Its message is a short code only ("HTTP 401",
// "timeout"), never the phone number, text, or Termii's own message.
export class TermiiError extends Error {
  override name = "TermiiError";
}

export function createTermiiProvider(config: TermiiConfig): SmsProvider {
  const endpoint = new URL("/api/sms/send", config.baseUrl).toString();

  return {
    async send({ to, text }: SmsMessage) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            api_key: config.apiKey,
            // International format without the "+".
            to: to.replace(/^\+/, ""),
            from: config.senderId,
            sms: text,
            type: "plain",
            channel: "dnd",
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new TermiiError(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error");
      }
      if (!response.ok) throw new TermiiError(`HTTP ${response.status}`);

      const parsed = sendResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new TermiiError("unexpected response");
      return { providerMessageId: parsed.data.message_id };
    },
  };
}
