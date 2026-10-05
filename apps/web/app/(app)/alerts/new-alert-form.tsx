"use client";
import { useActionState, useRef } from "react";
import { BellPlus } from "lucide-react";
import { createAlertAction, type FormState } from "./actions";

export function NewAlertForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, f) => { const r = await createAlertAction(p, f); if (!r) ref.current?.reset(); return r; }, null);
  return (
    <form ref={ref} action={action} className="card space-y-3 p-5">
      <div className="flex items-center gap-2 font-medium"><BellPlus className="h-4 w-4 text-accent-ink" />Watch for a word or phrase</div>
      <div className="flex flex-wrap items-center gap-2">
        <input name="keyword" required minLength={2} maxLength={80} placeholder="e.g. competitor name, refund, security review" aria-label="Word or phrase" className="field min-w-0 flex-[1_1_14rem]" />
        <button disabled={pending} className="btn btn-primary">Add alert</button>
      </div>
      <label className="flex w-fit items-center gap-2 text-sm text-muted"><input type="checkbox" name="email" defaultChecked className="check" /> Email me when it comes up</label>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}
