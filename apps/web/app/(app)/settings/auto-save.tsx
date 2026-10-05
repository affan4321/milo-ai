"use client";
import { useRef, useState, useTransition } from "react";

/** A group of settings that saves itself when any control changes, and says so. No Save button to forget. */
export function AutoSave({ action, children, className }: { action: (form: FormData) => Promise<{ error?: string } | null>; children: React.ReactNode; className?: string }) {
  const [state, setState] = useState<"idle" | "saved" | { error: string }>("idle");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <form className={className} onChange={(e) => {
      const form = e.currentTarget; const data = new FormData(form);
      start(async () => { const r = await action(data); clearTimeout(timer.current); if (r?.error) setState({ error: r.error }); else { setState("saved"); timer.current = setTimeout(() => setState("idle"), 2000); } });
    }}>
      {children}
      <div className="mt-2 h-4 text-xs" aria-live="polite">
        {pending ? <span className="text-muted">Saving…</span> : state === "saved" ? <span className="text-muted">Saved ✓</span> : typeof state === "object" ? <span className="text-red-500">{state.error}</span> : null}
      </div>
    </form>
  );
}
