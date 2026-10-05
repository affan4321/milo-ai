"use client";
import { RotateCw, TriangleAlert } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center p-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-danger/25 bg-danger/10 text-danger"><TriangleAlert className="h-6 w-6" /></span>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">This page hit an error. Your meetings and recordings are safe. Try again, and if it keeps happening, reload.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-subtle">Reference: {error.digest}</p>}
      <button onClick={reset} className="btn btn-primary mt-6"><RotateCw />Try again</button>
    </div>
  );
}
