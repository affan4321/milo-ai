"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteChatAction } from "./actions";

const SCOPE: Record<string, string> = { my: "My calls", team: "Team", all: "All calls" };
function ago(iso: string) {
  const s = (Date.now() - +new Date(iso)) / 1000;
  if (s < 90) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function ChatList({ threads }: { threads: { id: string; title: string; scope: string; updatedAt: string }[] }) {
  const { threadId } = useParams<{ threadId?: string }>();
  const router = useRouter();
  const [pending, start] = useTransition();
  // A fresh timestamp makes /ask a new page instance every time, so "New chat" always starts clean (even from /ask itself).
  const newChat = () => router.push(`/ask?n=${Date.now()}`);
  function remove(id: string, title: string) {
    if (!window.confirm(`Delete this chat?\n\n“${title}”`)) return;
    start(async () => { await deleteChatAction(id); if (id === threadId) router.push(`/ask?n=${Date.now()}`); });
  }
  return (
    <aside className="w-full shrink-0 md:w-60">
      <button onClick={newChat} className="mb-3 w-full rounded bg-accent px-3 py-2 text-sm font-medium text-white">+ New chat</button>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Your chats</div>
      {threads.length === 0 && <p className="text-xs text-muted">Chats you start are saved here, so you can come back to them.</p>}
      <ul className="max-h-48 space-y-0.5 overflow-y-auto md:max-h-[70vh]">
        {threads.map((t) => (
          <li key={t.id} className={`group flex items-start gap-1 rounded ${t.id === threadId ? "bg-accent/15" : "hover:bg-surface"}`}>
            <Link href={`/ask/${t.id}`} className="min-w-0 flex-1 px-2 py-1.5">
              <div className="truncate text-sm">{t.title}</div>
              <div className="text-[11px] text-muted">{SCOPE[t.scope] ?? t.scope} · {ago(t.updatedAt)}</div>
            </Link>
            <button disabled={pending} onClick={() => remove(t.id, t.title)} title="Delete chat" aria-label="Delete chat" className="invisible px-2 py-1.5 text-xs text-muted hover:text-red-500 group-hover:visible">✕</button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
