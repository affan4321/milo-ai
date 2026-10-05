import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Milo", description: "AI meeting notetaker" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("milo-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
