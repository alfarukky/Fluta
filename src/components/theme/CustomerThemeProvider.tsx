"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

import { SCRIPT_PROPS } from "./ThemeProvider";

// Customer pages follow the phone's light or dark setting. There is no toggle,
// so nothing ever writes this storage key: it only keeps next-themes away from
// the staff pages' saved choice ("theme"), which customer pages never read.
export const CUSTOMER_THEME_STORAGE_KEY = "fluta-customer-theme";

interface CustomerThemeProviderProps {
  children: ReactNode;
}

export function CustomerThemeProvider({ children }: CustomerThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={CUSTOMER_THEME_STORAGE_KEY}
      disableTransitionOnChange
      scriptProps={SCRIPT_PROPS}
    >
      {children}
    </NextThemesProvider>
  );
}
