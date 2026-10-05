import { notFound } from "next/navigation";
import { getDb } from "@milo/db";
import { loadThread } from "@milo/search";
import { getCurrentUser } from "@/lib/session";
import { AskChat } from "../ask-chat";

export const dynamic = "force-dynamic";

/** A saved chat, reopened with its messages and citations (re-resolved, so timestamps are current). */
export default async function SavedAsk({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) notFound();
  const user = await getCurrentUser();
  const t = await loadThread(getDb(), user.id, threadId);
  if (!t) notFound();
  return <AskChat key={threadId} initial={{ threadId, scope: t.thread.scope, messages: t.messages }} />;
}
