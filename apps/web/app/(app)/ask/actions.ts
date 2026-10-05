"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@milo/db";
import { getProviders } from "@milo/providers";
import { askMilo, deleteThread, editMessage, loadThread, parseScope, type Scope, type ThreadMessage } from "@milo/search";
import { getCurrentUser } from "@/lib/session";

export type ChatResult = { threadId: string; messages: ThreadMessage[]; degraded: boolean } | { error: string };

async function reload(userId: string, r: { threadId: string; degraded: boolean } | { error: string }): Promise<ChatResult> {
  if ("error" in r) return r;
  const t = await loadThread(getDb(), userId, r.threadId);
  return t ? { threadId: r.threadId, messages: t.messages, degraded: r.degraded } : { error: "The conversation couldn't be loaded." };
}

/** Ask in a new chat (threadId null) or continue a saved one. Returns the whole saved conversation so the UI always matches the database. */
export async function askAction(question: string, scope: Scope, threadId: string | null): Promise<ChatResult> {
  const user = await getCurrentUser();
  const r = await askMilo(getDb(), getProviders().llm, user.id, { question, scope: parseScope(scope), threadId });
  if (!("error" in r)) revalidatePath("/ask", "layout");
  return reload(user.id, r);
}

/** Rewrite one of your questions; the chat continues from that point with a fresh answer. */
export async function editAction(threadId: string, messageId: string, question: string, scope: Scope): Promise<ChatResult> {
  const user = await getCurrentUser();
  const r = await editMessage(getDb(), getProviders().llm, user.id, { threadId, messageId, question, scope: parseScope(scope) });
  if (!("error" in r)) revalidatePath("/ask", "layout");
  return reload(user.id, r);
}

export async function deleteChatAction(threadId: string) {
  const user = await getCurrentUser();
  await deleteThread(getDb(), user.id, threadId);
  revalidatePath("/ask", "layout");
}
