import { ChallengeList } from "@/components/ChallengeList";
import { ChallengeComposer } from "@/components/Challenges";
import type { Challenge } from "@/lib/challenges";
import type { LibraryGame } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import type { Person } from "@/lib/people";
import { type CommunityCard, gameOptions } from "@/lib/psn";
import { apiJson, currentUser } from "@/lib/session";
import { titled } from "@/lib/titles";
import Link from "next/link";
import { redirect } from "next/navigation";

export const generateMetadata = () => titled((t) => t.challenges);

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const tabs = ["current", "mine", "ended"] as const;
type Tab = (typeof tabs)[number];
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Challenges the reader may see: running and coming, their own, or over; and making one. */
export default async function Challenges({ searchParams }: Search) {
  const query = await searchParams;
  const tab: Tab = tabs.find((t) => t === one(query.tab)) ?? "current";
  const game = /^[A-Z]{4}[0-9]{5}$/.test(one(query.game) ?? "") ? (one(query.game) as string) : null;
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect(`/login?next=${encodeURIComponent("/challenges")}`);
  const listPath =
    tab === "mine" ? "/me/challenges" : tab === "ended" ? "/challenges?state=ended" : "/challenges";
  const [list, library, joined, friends] = await Promise.all([
    apiJson<{ challenges: Challenge[] }>(listPath),
    apiJson<{ games: LibraryGame[] }>(`/users/${encodeURIComponent(user.profile.handle)}/library`),
    apiJson<{ communities: CommunityCard[] }>("/me/communities"),
    apiJson<{ friends: Person[] }>("/me/friends"),
  ]);
  const t = ui(texts);
  const games = gameOptions(library.body?.games ?? [], texts.language);
  const challenges = list.body?.challenges ?? [];
  const empty =
    tab === "mine"
      ? texts.challengesEmptyMine
      : tab === "ended"
        ? texts.challengesEmptyEnded
        : texts.challengesEmpty;
  const href = (next: Tab) => (next === "current" ? "/challenges" : `/challenges?tab=${next}`);

  return (
    <section className="page challenges">
      <h2 className="in d1">{texts.challenges}</h2>
      <p className="lead in d2">{texts.challengesLead}</p>
      <nav className="switch" aria-label={texts.leaderboards}>
        <Link href="/leaderboards">{texts.leaderboards}</Link>
        <Link href="/challenges" aria-current="page">
          {texts.challenges}
        </Link>
      </nav>

      <div className="board-controls in d3">
        <nav className="seg" aria-label={texts.challenges}>
          {tabs.map((name) => (
            <Link key={name} href={href(name)} aria-current={name === tab ? "true" : undefined}>
              {
                {
                  current: texts.challengesCurrent,
                  mine: texts.challengesMine,
                  ended: texts.challengesEnded,
                }[name]
              }
            </Link>
          ))}
        </nav>
        <ChallengeComposer
          texts={t}
          games={games}
          communities={(joined.body?.communities ?? []).map((c) => ({ id: c.id, name: c.name }))}
          friends={friends.body?.friends ?? []}
          startOpen={one(query.new) === "1"}
          defaultGame={game}
        />
      </div>

      <article className="card in d4">
        {challenges.length === 0 ? (
          <p className="empty">{empty}</p>
        ) : (
          <ChallengeList challenges={challenges} texts={texts} />
        )}
      </article>
    </section>
  );
}
