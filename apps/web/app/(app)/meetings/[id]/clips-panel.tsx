"use client";
import { useState, useTransition } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { formatMs } from "@milo/core";
import { revokeClipShareAction, shareClipAction } from "./actions";

export interface ClipView { id: string; startMs: number; endMs: number; title: string | null; status: string; error: string | null; token: string | null; views: number }

/** The owner's clips: preparing / ready, a public link to copy, and a switch to turn the link off. */
export function ClipsPanel({ clips }: { clips: ClipView[] }) {
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!clips.length) return null;

  const link = (token: string) => `${window.location.origin}/share/${token}`;
  async function copy(token: string, id: string) {
    try { await navigator.clipboard.writeText(link(token)); setCopied(id); setTimeout(() => setCopied(null), 1600); } catch { setErr("Couldn't copy automatically. Select the link and copy it."); }
  }
  function share(c: ClipView) {
    setErr(null);
    start(async () => { const r = await shareClipAction(c.id); if (r.ok) await copy(r.token, c.id); else setErr(r.error); });
  }
  return (
    <div>
      <ul className="space-y-2 text-sm">
        {clips.map((c) => (
          <li key={c.id} className="rounded-lg border border-border bg-bg p-2.5 pl-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{c.title ?? "Clip"} <span className="ml-1 font-mono text-xs font-normal text-subtle">{formatMs(c.startMs)}–{formatMs(c.endMs)}</span></span>
              {c.status === "pending" && <span className="flex shrink-0 items-center gap-1.5 text-xs text-warn"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />Preparing…</span>}
              {c.status === "failed" && <span className="shrink-0 text-xs font-medium text-danger" title={c.error ?? ""}>Failed</span>}
              {c.status === "ready" && !c.token && <button disabled={pending} onClick={() => share(c)} className="btn btn-primary btn-sm"><Link2 />Get public link</button>}
              {c.status === "ready" && c.token && (
                <span className="flex shrink-0 gap-1">
                  <button onClick={() => copy(c.token!, c.id)} className="btn btn-secondary btn-sm">{copied === c.id ? <><Check />Copied</> : <><Copy />Copy link</>}</button>
                  <button disabled={pending} onClick={() => start(() => revokeClipShareAction(c.id))} className="btn btn-ghost btn-danger btn-sm">Turn off</button>
                </span>
              )}
            </div>
            {c.status === "ready" && c.token && <div className="mt-1 break-all font-mono text-[11px] text-subtle">…/share/{c.token.slice(0, 8)}… · {c.views} {c.views === 1 ? "view" : "views"}</div>}
            {c.status === "failed" && <div className="mt-1 text-xs text-muted">{c.error}</div>}
          </li>
        ))}
      </ul>
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  );
}
