import { CustomerThemeProvider } from "@/components/theme/CustomerThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { StagingBanner } from "@/components/shared/StagingBanner";
import { isStaging } from "@/lib/env";

// Customer pages (booking, and tracking from Feature 14): the phone's light or
// dark setting, never the staff pages' saved theme, and no theme toggle.
export default function CustomerLayout({ children }: LayoutProps<"/">) {
  return (
    <CustomerThemeProvider>
      {isStaging() && <StagingBanner />}
      {children}
      <Toaster />
    </CustomerThemeProvider>
  );
}
