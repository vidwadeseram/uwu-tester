import type { Metadata } from "next";
import "./globals.css";
import Navbar from "./components/Navbar";

export const metadata: Metadata = {
  title: "VPS Dev Dashboard",
  description: "Web-based development environment manager for VPS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-grid min-h-screen" style={{ background: "#0a0e1a" }}>
        <Navbar />
        <main className="pt-14">{children}</main>
      </body>
    </html>
  );
}
