import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";

/** Shared frame for the public legal pages: a plain header, a readable column, and links between the two documents. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Milo.ai home"><Logo /></Link>
          <nav className="flex gap-5 text-sm text-muted" aria-label="Legal"><Link href="/privacy" className="hover:text-text">Privacy</Link><Link href="/terms" className="hover:text-text">Terms</Link></nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 animate-rise px-4 py-12 sm:px-6 sm:py-16">{children}</main>
      <footer className="border-t border-border px-4 py-8 text-center text-xs text-subtle sm:px-6">Milo.ai, an AI meeting notetaker. <Link href="/" className="hover:text-text">Back to home</Link></footer>
    </div>
  );
}
