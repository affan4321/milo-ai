"use client";
import { useOptimistic, useTransition } from "react";
import { toggleRecordAction } from "./actions";

export function RecordToggle({ eventId, record }: { eventId: string; record: boolean }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useOptimistic(record);
  return (
    <button disabled={pending} onClick={() => start(async () => { setOn(!on); await toggleRecordAction(eventId, !on); })}
      className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-accent text-accent" : "border-border text-muted"}`}
      title={on ? "Milo will join and record. Click to skip this meeting." : "Milo will skip this meeting. Click to record it."}>
      {on ? "Milo will record" : "Not recording"}
    </button>
  );
}
