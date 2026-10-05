"use client";
import { useRef, useState, useTransition } from "react";
import { Check } from "lucide-react";

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
        {pending ? <span className="text-muted">Saving…</span> : state === "saved" ? <span className="inline-flex animate-fade items-center gap-1 font-medium text-success"><Check className="h-3.5 w-3.5" />Saved</span> : typeof state === "object" ? <span className="text-danger">{state.error}</span> : null}
      </div>
    </form>
  );
}
