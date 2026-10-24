import { PartyBoard } from "@/components/PartyBoard";
import { strings, ui } from "@/lib/i18n";
import type { Friend } from "@/lib/people";
import { apiJson, currentUser } from "@/lib/session";
import type { Party, PartyInvite } from "@/lib/social";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Party · AnyTogether" };

export default async function PartyPage() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/party");
  const [mine, friends] = await Promise.all([
    apiJson<{ party: Party | null; invites: PartyInvite[] }>("/me/party"),
    apiJson<{ friends: Friend[] }>("/me/friends"),
  ]);
  return (
    <PartyBoard
      texts={ui(texts)}
      initialParty={mine.body?.party ?? null}
      initialInvites={mine.body?.invites ?? []}
      initialFriends={friends.body?.friends ?? []}
    />
  );
}
