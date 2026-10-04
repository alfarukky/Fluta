import { z } from "zod";

// Better Auth's default password limits; sign-in rejects anything outside them.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const newUserSchema = z.object({
  name: z.string().trim().min(1, "Enter a name"),
  // Better Auth lowercases the email at sign-in, so it's stored lowercased.
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  platformRole: z.enum(["USER", "FLUTA_ADMIN"]).default("USER"),
});

export type NewUserInput = z.input<typeof newUserSchema>;
