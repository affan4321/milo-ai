"use client";
import { useActionState } from "react";
import { connectIcsAction, type ConnectState } from "./actions";

export function ConnectIcsForm() {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectIcsAction, null);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <div className="font-medium">Connect a calendar</div>
      <p className="text-sm text-muted">Paste your calendar&apos;s secret iCal address (Google Calendar: Settings → your calendar → Secret address in iCal format).</p>
      <div className="flex gap-2">
        <input name="url" required placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          className="min-w-0 flex-1 rounded border border-border bg-bg px-3 py-2 text-sm" />
        <button disabled={pending} className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? "Connecting…" : "Connect"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
      {state?.synced !== undefined && <p className="text-sm text-muted">Synced {state.synced} upcoming events.</p>}
    </form>
  );
}
