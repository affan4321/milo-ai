import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Milo", description: "AI meeting notetaker" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
