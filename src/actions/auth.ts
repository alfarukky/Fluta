"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/server/auth/auth";
import { SIGN_IN_PATH } from "@/server/auth/session";

// Deletes the session row and clears the cookie (nextCookies plugin).
export async function signOut(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect(SIGN_IN_PATH);
}
