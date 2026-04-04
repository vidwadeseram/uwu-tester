import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import AppLayout from "./components/AppLayout";

export const metadata: Metadata = {
  title: "uwu-code",
  description: "Web-based development environment manager for VPS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-grid min-h-screen font-mono" style={{ background: "var(--bg)" }}>
        <ThemeProvider>
          <AppLayout>{children}</AppLayout>
        </ThemeProvider>
      </body>
    </html>
  );
}
