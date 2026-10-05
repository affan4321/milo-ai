"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">This page hit an error. Your meetings and recordings are safe. Try again, and if it keeps happening, reload.</p>
      {error.digest && <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      <button onClick={reset} className="mt-4 rounded bg-accent px-3 py-1.5 text-sm text-white">Try again</button>
    </div>
  );
}
