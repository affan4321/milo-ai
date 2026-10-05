import type { ReactNode } from "react";
import { getDb } from "@milo/db";
import { listThreads } from "@milo/search";
import { getCurrentUser } from "@/lib/session";
import { ChatList } from "./chat-list";

export const dynamic = "force-dynamic";

/** Saved chats on the left, the open chat on the right. Chats persist, so you can come back to any of them. */
export default async function AskLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const threads = (await listThreads(getDb(), user.id)).map((t) => ({ id: t.id, title: t.title, scope: t.scope, updatedAt: t.updatedAt.toISOString() }));
  return (
    <div className="flex max-w-5xl flex-col gap-4 md:flex-row">
      <ChatList threads={threads} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
