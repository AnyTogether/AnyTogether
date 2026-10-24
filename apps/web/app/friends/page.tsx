import { FriendsBoard } from "@/components/FriendsBoard";
import { strings, ui } from "@/lib/i18n";
import type { Friend, Requests } from "@/lib/people";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Friends · AnyTogether" };

export default async function Friends() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/friends");
  const [list, asks] = await Promise.all([
    apiJson<{ friends: Friend[] }>("/me/friends"),
    apiJson<Requests>("/me/friends/requests"),
  ]);
  return (
    <FriendsBoard
      texts={ui(texts)}
      me={user.profile.handle}
      initialFriends={list.body?.friends ?? []}
      initialRequests={asks.body ?? { incoming: [], outgoing: [] }}
      now={Date.now()}
    />
  );
}
