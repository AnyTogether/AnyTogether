import { CommunityComposer, CommunityFinder, CommunityRow } from "@/components/Communities";
import { RefreshOn } from "@/components/Discover";
import { EventDays } from "@/components/Events";
import type { LibraryGame } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { type CommunityCard, type CommunityInvite, type PlannedEvent, gameOptions } from "@/lib/psn";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Communities · AnyTogether" };

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The reader's communities and invites, what is coming up, and public ones to find by game. */
export default async function Communities({ searchParams }: Search) {
  const query = await searchParams;
  const game = typeof query.game === "string" && /^[A-Z]{4}[0-9]{5}$/.test(query.game) ? query.game : null;
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/communities");
  const [mine, found, events, library] = await Promise.all([
    apiJson<{ communities: CommunityCard[]; invites: CommunityInvite[] }>("/me/communities"),
    apiJson<{ communities: CommunityCard[] }>(`/communities${game ? `?titleId=${game}` : ""}`),
    apiJson<{ events: PlannedEvent[] }>("/me/events"),
    apiJson<{ games: LibraryGame[] }>(`/users/${encodeURIComponent(user.profile.handle)}/library`),
  ]);
  // A child whose parents keep communities off: the API refuses the list, and the page says why.
  if (found.status === 403)
    return (
      <section className="page">
        <h2 className="in d1">{texts.communities}</h2>
        <p className="lead in d2">{texts.restrictedNotice}</p>
        <div className="toolbar in d2">
          <Link href="/family" className="pill">
            {texts.family}
          </Link>
        </div>
      </section>
    );
  const t = ui(texts);
  const games = gameOptions(library.body?.games ?? [], texts.language);
  const listed = found.body?.communities.find((c) => c.titleId === game);
  if (game && !games.some((g) => g.titleId === game))
    games.unshift({
      titleId: game,
      name:
        (listed?.game &&
          gameOptions([{ titleId: game, names: listed.game.names }], texts.language)[0]?.name) ||
        game,
    });
  const joined = mine.body?.communities ?? [];
  const invites = mine.body?.invites ?? [];
  const soon = (events.body?.events ?? []).slice(0, 6);
  return (
    <section className="page">
      <RefreshOn
        topics={[]}
        events={["community.updated", "community.left", "event.updated", "event.cancelled", "event.started"]}
      />
      <h2 className="in d1">{texts.communities}</h2>
      <p className="lead in d2">{texts.communitiesLead}</p>
      <div className="toolbar in d2">
        <CommunityComposer texts={t} games={games} defaultGame={game} />
        <Link href="/events" className="pill">
          {texts.events}
        </Link>
        <Link href="/players" className="pill">
          {texts.playersMet}
        </Link>
      </div>

      {invites.length > 0 && (
        <article className="card in d3">
          <h3 className="sub">
            {texts.communityInvites} <span className="n">{invites.length}</span>
          </h3>
          <ul className="community-list">
            {invites.map((invite) => (
              <li key={invite.community.id}>
                <CommunityRow community={invite.community} texts={t} />
                {invite.from && (
                  <p className="meta">{fill(texts.invitedBy, { name: invite.from.displayName })}</p>
                )}
              </li>
            ))}
          </ul>
        </article>
      )}

      <article className="card in d3">
        <h3 className="sub">
          {texts.myCommunities} <span className="n">{joined.length}</span>
        </h3>
        {joined.length === 0 ? (
          <p className="empty">{texts.noMyCommunities}</p>
        ) : (
          <ul className="community-list">
            {joined.map((community) => (
              <li key={community.id}>
                <CommunityRow community={community} texts={t} />
              </li>
            ))}
          </ul>
        )}
      </article>

      {soon.length > 0 && (
        <article className="card in d3">
          <div className="card-head">
            <h3 className="sub">{texts.events}</h3>
            <Link href="/events" className="quiet-link">
              {texts.allEvents}
            </Link>
          </div>
          <EventDays texts={t} events={soon} empty={texts.noEvents} />
        </article>
      )}

      <article className="card in d4">
        <h3 className="sub">{texts.discoverCommunities}</h3>
        <CommunityFinder texts={t} initial={found.body?.communities ?? []} games={games} titleId={game} />
      </article>
    </section>
  );
}
