import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { cookies } from "next/headers";
import { product } from "@/config/product";
import "./globals.css";

export const metadata: Metadata = { title: product.name, description: product.tagline };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("ucs_theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="en" data-theme={theme} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
