import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "shop_ai",
  description: "Shop AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro">
      <body className="font-sans">{children}</body>
    </html>
  );
}