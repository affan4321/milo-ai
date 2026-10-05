import { AskChat } from "./ask-chat";
export const dynamic = "force-dynamic";
/** A new chat. The `n` query value only exists to give each "New chat" click a fresh component (see ChatList). */
export default async function NewAsk({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { n } = await searchParams;
  return <AskChat key={n ?? "new"} initial={null} />;
}
