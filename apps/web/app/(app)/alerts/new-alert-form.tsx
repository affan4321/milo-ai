"use client";
import { useActionState, useRef } from "react";
import { createAlertAction, type FormState } from "./actions";

export function NewAlertForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, f) => { const r = await createAlertAction(p, f); if (!r) ref.current?.reset(); return r; }, null);
  return (
    <form ref={ref} action={action} className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <div className="font-medium">Watch for a word or phrase</div>
      <div className="flex flex-wrap items-center gap-2">
        <input name="keyword" required minLength={2} maxLength={80} placeholder="e.g. competitor name, refund, security review" className="min-w-0 flex-1 rounded border border-border bg-bg px-3 py-2 text-sm" />
        <button disabled={pending} className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">Add alert</button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="email" defaultChecked /> Email me when it comes up</label>
      {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
    </form>
  );
}
