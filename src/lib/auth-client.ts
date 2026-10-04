import { createAuthClient } from "better-auth/react";

// Browser client for /api/auth/*. Sign-in goes through it (not a server
// action) so Better Auth's rate limit applies to every attempt.
export const authClient = createAuthClient();
