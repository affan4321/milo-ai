"use client";
import { useOptimistic, useTransition } from "react";
import { setVisibilityAction } from "./actions";

export function VisibilityToggle({ meetingId, visibility }: { meetingId: string; visibility: string }) {
  const [pending, start] = useTransition();
  const [v, setV] = useOptimistic(visibility);
  const team = v === "team";
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted" title="Teammates in your workspace can find a shared meeting in Team calls, search and Ask Milo. Private meetings are only ever visible to you.">
      <input type="checkbox" checked={team} disabled={pending} onChange={() => start(async () => { const next = team ? "private" : "team"; setV(next); await setVisibilityAction(meetingId, next); })} />
      {team ? "Shared with your team" : "Private to you"}
    </label>
  );
}
