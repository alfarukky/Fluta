import "server-only";

import { Resend } from "resend";

import { getServerEnv } from "@/lib/env";

// Fluta's one mailer: email through Resend's API, with a plain-text part
// always and an HTML part when given. The only module
// that sends email; tests replace it with the fake in src/test/fake-mailer.ts.
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

let mailer: Mailer | undefined;

// Created on first use so `next build` needs no Resend secrets.
export function getMailer(): Mailer {
  mailer ??= createResendMailer();
  return mailer;
}

function createResendMailer(): Mailer {
  const env = getServerEnv();
  const resend = new Resend(env.RESEND_API_KEY);

  return {
    async send({ to, subject, text, html }) {
      const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject, text, html });
      // Resend returns failures instead of throwing. Throw so callers see a
      // failed send, carrying only Resend's error code (e.g. "invalid_api_key"),
      // never the message, which can echo the address.
      if (error) {
        const failure = new Error("Resend rejected the email");
        failure.name = error.name;
        throw failure;
      }
    },
  };
}
