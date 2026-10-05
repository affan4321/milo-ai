"use client";
import { useOptimistic, useTransition } from "react";
import { toggleRecordAction } from "./actions";

export function RecordToggle({ eventId, record }: { eventId: string; record: boolean }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useOptimistic(record);
  return (
    <label className="flex shrink-0 items-center gap-2.5 text-xs" title={on ? "Milo will join and record. Switch off to skip this meeting." : "Milo will skip this meeting. Switch on to record it."}>
      <span className={`hidden sm:inline ${on ? "font-medium text-accent-ink" : "text-muted"}`}>{on ? "Milo will record" : "Not recording"}</span>
      <input type="checkbox" className="switch" checked={on} disabled={pending} aria-label="Record this meeting"
        onChange={() => start(async () => { setOn(!on); await toggleRecordAction(eventId, !on); })} />
    </label>
  );
}
