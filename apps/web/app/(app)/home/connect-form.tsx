"use client";
import { useActionState } from "react";
import { CalendarPlus } from "lucide-react";
import { connectIcsAction, type ConnectState } from "./actions";

export function ConnectIcsForm() {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectIcsAction, null);
  return (
    <form action={action} className="card space-y-3 p-5">
      <div className="flex items-center gap-2 font-medium"><CalendarPlus className="h-4 w-4 text-accent-ink" />Connect a calendar</div>
      <p className="text-sm leading-relaxed text-muted">Paste your calendar&apos;s secret iCal address. In Google Calendar: Settings → your calendar → Secret address in iCal format.</p>
      <div className="flex flex-wrap gap-2">
        <input name="url" required placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" aria-label="Secret iCal address" className="field min-w-0 flex-[1_1_12rem]" />
        <button disabled={pending} className="btn btn-primary">{pending ? "Connecting…" : "Connect"}</button>
      </div>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {state?.synced !== undefined && <p className="text-sm text-success">Synced {state.synced} upcoming events.</p>}
    </form>
  );
}
