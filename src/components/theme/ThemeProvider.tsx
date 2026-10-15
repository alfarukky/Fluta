"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

// next-themes renders an inline script that sets the theme before first
// paint. React warns whenever it has to create a <script> in the browser (it
// never runs those), which happens when a not-found page re-renders the root
// layout there. In the browser the script is marked as data so React stays
// quiet; the server-rendered script is unchanged and still runs before paint.
export const SCRIPT_PROPS = typeof window === "undefined" ? undefined : { type: "application/json" };

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      scriptProps={SCRIPT_PROPS}
    >
      {children}
    </NextThemesProvider>
  );
}
