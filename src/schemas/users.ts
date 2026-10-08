import { z } from "zod";

import { normalizeEmail } from "@/lib/email-address";

// The one password rule, used by Better Auth's config (sign-in and password
// reset), invitation acceptance, and users.ts. The maximum is Better Auth's
// default; sign-in rejects anything longer.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export const PASSWORD_TOO_SHORT_MESSAGE = `Use at least ${MIN_PASSWORD_LENGTH} characters`;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters`);

// Normalized before it is checked, so surrounding spaces never fail validation.
export const emailSchema = z.string().transform(normalizeEmail).pipe(z.email("Enter a valid email address"));

export const newUserSchema = z.object({
  name: z.string().trim().min(1, "Enter a name"),
  email: emailSchema,
  password: passwordSchema,
  platformRole: z.enum(["USER", "FLUTA_ADMIN"]).default("USER"),
});

export type NewUserInput = z.input<typeof newUserSchema>;
