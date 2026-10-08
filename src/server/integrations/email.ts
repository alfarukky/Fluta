import "server-only";

import nodemailer from "nodemailer";

import { getServerEnv } from "@/lib/env";

// Fluta's one mailer: email over SMTP (Nodemailer), with a plain-text part
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

// Created on first use so `next build` needs no SMTP secrets.
export function getMailer(): Mailer {
  mailer ??= createSmtpMailer();
  return mailer;
}

function createSmtpMailer(): Mailer {
  const env = getServerEnv();
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is TLS from the first byte; other ports must upgrade with STARTTLS.
    secure: env.SMTP_PORT === 465,
    requireTLS: env.SMTP_PORT !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  return {
    async send({ to, subject, text, html }) {
      await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text, html });
    },
  };
}
