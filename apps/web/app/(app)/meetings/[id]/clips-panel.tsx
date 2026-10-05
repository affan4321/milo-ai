"use client";
import { useState, useTransition } from "react";
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
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Clips</h3>
      <ul className="space-y-1.5 text-sm">
        {clips.map((c) => (
          <li key={c.id} className="rounded border border-border p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{c.title ?? "Clip"} <span className="font-mono text-xs text-muted">{formatMs(c.startMs)}–{formatMs(c.endMs)}</span></span>
              {c.status === "pending" && <span className="shrink-0 text-xs text-muted">Preparing…</span>}
              {c.status === "failed" && <span className="shrink-0 text-xs text-red-500" title={c.error ?? ""}>Failed</span>}
              {c.status === "ready" && !c.token && <button disabled={pending} onClick={() => share(c)} className="shrink-0 rounded bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-60">Get public link</button>}
              {c.status === "ready" && c.token && (
                <span className="flex shrink-0 gap-2 text-xs">
                  <button onClick={() => copy(c.token!, c.id)} className="rounded border border-border px-2 py-1 hover:border-accent">{copied === c.id ? "Copied" : "Copy link"}</button>
                  <button disabled={pending} onClick={() => start(() => revokeClipShareAction(c.id))} className="text-muted underline hover:text-text">Turn off</button>
                </span>
              )}
            </div>
            {c.status === "ready" && c.token && <div className="mt-1 break-all font-mono text-[11px] text-muted">…/share/{c.token.slice(0, 8)}… · {c.views} {c.views === 1 ? "view" : "views"}</div>}
            {c.status === "failed" && <div className="mt-1 text-xs text-muted">{c.error}</div>}
          </li>
        ))}
      </ul>
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
    </div>
  );
}
