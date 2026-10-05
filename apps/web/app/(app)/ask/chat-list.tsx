"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
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
    <aside className="flex w-full shrink-0 flex-col lg:w-64">
      <button onClick={newChat} className="btn btn-primary w-full"><Plus />New chat</button>
      <div className="eyebrow mb-2 mt-6 px-1">Your chats</div>
      {threads.length === 0 && <p className="px-1 text-sm leading-relaxed text-muted">Chats you start are saved here, so you can come back to them.</p>}
      <ul className="-mx-1 max-h-44 space-y-0.5 overflow-y-auto px-1 lg:max-h-none lg:flex-1">
        {threads.map((t) => (
          <li key={t.id} className={`group flex items-start rounded-lg transition-colors ${t.id === threadId ? "bg-accent/10" : "hover:bg-raised"}`}>
            <Link href={`/ask/${t.id}`} className="min-w-0 flex-1 px-3 py-2">
              <div className={`truncate text-sm ${t.id === threadId ? "font-medium text-accent-ink" : ""}`}>{t.title}</div>
              <div className="mt-0.5 text-[11px] text-subtle">{SCOPE[t.scope] ?? t.scope} · {ago(t.updatedAt)}</div>
            </Link>
            <button disabled={pending} onClick={() => remove(t.id, t.title)} title="Delete chat" aria-label="Delete chat" className="btn btn-ghost btn-danger btn-sm btn-icon m-1 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"><Trash2 /></button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
