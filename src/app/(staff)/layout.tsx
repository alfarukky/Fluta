import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";

// Fluta's own pages (home, sign-in, workspace, admin): light by default, with
// the saved theme choice and the theme toggle.
export default function StaffLayout({ children }: LayoutProps<"/">) {
  return (
    <ThemeProvider>
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
