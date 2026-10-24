import { MessagesBoard } from "@/components/MessagesBoard";
import { strings, ui } from "@/lib/i18n";
import { type Friend, isUserId } from "@/lib/people";
import { apiJson, currentUser } from "@/lib/session";
import type { Conversation } from "@/lib/social";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Messages · AnyTogether" };

export default async function Messages({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const [texts, user, { c }] = await Promise.all([strings(), currentUser(), searchParams]);
  if (!user) redirect("/login?next=/messages");
  const [list, friends] = await Promise.all([
    apiJson<{ conversations: Conversation[] }>("/me/conversations"),
    apiJson<{ friends: Friend[] }>("/me/friends"),
  ]);
  const conversations = list.body?.conversations ?? [];
  const selected = c && isUserId(c) && conversations.some((x) => x.id === c) ? c : null;
  return (
    <MessagesBoard
      texts={ui(texts)}
      locale={texts.language}
      initialConversations={conversations}
      initialSelected={selected}
      friends={(friends.body?.friends ?? []).map(({ presence: _, ...person }) => person)}
    />
  );
}
