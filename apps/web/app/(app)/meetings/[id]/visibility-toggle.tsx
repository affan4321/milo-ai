"use client";
import { useOptimistic, useTransition } from "react";
import { Lock, Users } from "lucide-react";
import { setVisibilityAction } from "./actions";

export function VisibilityToggle({ meetingId, visibility }: { meetingId: string; visibility: string }) {
  const [pending, start] = useTransition();
  const [v, setV] = useOptimistic(visibility);
  const team = v === "team";
  return (
    <label className="inline-flex h-[1.875rem] items-center gap-2 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[13px] font-medium shadow-card" title="Teammates in your workspace can find a shared meeting in Team calls, search and Ask Milo. Private meetings are only ever visible to you.">
      {team ? <Users className="h-3.5 w-3.5 text-accent-ink" /> : <Lock className="h-3.5 w-3.5 text-subtle" />}
      {team ? "Shared with your team" : "Private to you"}
      <input type="checkbox" className="switch scale-90" checked={team} disabled={pending} aria-label="Share with your team" onChange={() => start(async () => { const next = team ? "private" : "team"; setV(next); await setVisibilityAction(meetingId, next); })} />
    </label>
  );
}
