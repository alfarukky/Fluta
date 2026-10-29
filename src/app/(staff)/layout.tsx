import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { StagingBanner } from "@/components/shared/StagingBanner";
import { isStaging } from "@/lib/env";

// Fluta's own pages (home, sign-in, workspace, admin): light by default, with
// the saved theme choice and the theme toggle.
export default function StaffLayout({ children }: LayoutProps<"/">) {
  return (
    <ThemeProvider>
      {isStaging() && <StagingBanner />}
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
