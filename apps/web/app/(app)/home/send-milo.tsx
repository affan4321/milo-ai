"use client";
import { useActionState, useState } from "react";
import { sendMiloAction, type SendState } from "./actions";

export function SendMilo() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<SendState, FormData>(sendMiloAction, null);
  if (!open) return <button onClick={() => setOpen(true)} className="rounded bg-accent px-4 py-2 text-sm font-medium text-white">Send Milo to a meeting</button>;
  return (
    <form action={action} className="w-full max-w-xl space-y-2 rounded-lg border border-border bg-surface p-4">
      <div className="font-medium">Send Milo to a meeting</div>
      <p className="text-sm text-muted">Paste a Google Meet link. Milo joins as &ldquo;Milo AI Notetaker&rdquo; and the host may need to let it in.</p>
      <input name="url" required placeholder="https://meet.google.com/abc-defg-hij" className="w-full rounded border border-border bg-bg px-3 py-2 text-sm" />
      <input name="title" placeholder="Title (optional)" className="w-full rounded border border-border bg-bg px-3 py-2 text-sm" />
      {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
      <div className="flex gap-2">
        <button disabled={pending} className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Sending…" : "Send Milo"}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border border-border px-4 py-2 text-sm">Cancel</button>
      </div>
    </form>
  );
}
