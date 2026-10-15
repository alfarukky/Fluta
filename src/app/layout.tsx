import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fluta",
  description: "Laundry store operations, bookings and order tracking.",
  // Declared here (not the app/favicon.ico file, which every page links) so a
  // store's customer pages replace it with the store's own icons.
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Each experience's own theme provider sets the theme class on <html>
    // before hydration: (staff) uses the saved choice, (customer) the phone's
    // setting. The root has none, so customer pages never read the staff one.
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
