import { FilterSelect, PeopleSearch } from "@/components/Discover";
import { FindTabs, PersonRow } from "@/components/DiscoverCards";
import type { Discovery, PersonCard } from "@/lib/discover";
import { type LibraryGame, localName } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "People · AnyTogether" };

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Finding people: by handle or name, people one may know, and who plays one of one's games. */
export default async function FindPeople({ searchParams }: Search) {
  const query = await searchParams;
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/find/people");
  const [suggestions, discovery, library] = await Promise.all([
    apiJson<{ suggestions: PersonCard[] }>("/discover/suggestions"),
    apiJson<Discovery>("/me/discovery"),
    apiJson<{ games: LibraryGame[] }>(`/users/${user.profile.handle}/library`),
  ]);
  const { language } = texts;
  const t = ui(texts);
  const now = Date.now();
  const games = library.body?.games ?? [];
  const asked = one(query.game) ?? "";
  const game = /^[A-Z]{4}[0-9]{5}$/.test(asked) ? asked : (games[0]?.titleId ?? "");
  const players = game
    ? await apiJson<{ players: PersonCard[] }>(`/discover/players?titleId=${game}`)
    : { body: null };
  const options: [string, string][] = games.map((g) => [
    g.titleId,
    localName(g.names, language) || g.titleId,
  ]);
  if (game && !options.some(([id]) => id === game)) options.unshift([game, game]);
  const gameLabel = options.find(([id]) => id === game)?.[1] ?? game;
  const list = suggestions.body?.suggestions ?? [];

  return (
    <section className="page find">
      <div className="find-head in d1">
        <h2>{texts.findPlayers}</h2>
      </div>
      <p className="lead in d2">{texts.peopleLead}</p>
      <FindTabs current="people" texts={texts} />

      <div className="in d3 find-stack">
        {discovery.body && !discovery.body.discoverable && (
          <p className="card hidden-note">
            <span>{texts.hiddenFromDiscovery}</span>
            <Link href="/settings#discovery" className="pill">
              {texts.change}
            </Link>
          </p>
        )}
        <PeopleSearch texts={t} />

        <article className="card">
          <h3 className="sub">
            {texts.suggestions} <span className="n">{list.length}</span>
          </h3>
          {list.length === 0 ? (
            <p className="hint empty">{texts.noSuggestions}</p>
          ) : (
            <ul className="people">
              {list.map((card) => (
                <PersonRow key={card.user.userId} card={card} texts={texts} ui={t} now={now} />
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <div className="card-head">
            <h3 className="sub">{game ? fill(texts.playersOf, { game: gameLabel }) : texts.playersOfPick}</h3>
            {options.length > 1 && (
              <FilterSelect name="game" value={game} label={texts.filterGame} options={options} />
            )}
          </div>
          <p className="hint section-lead">{texts.playersOfLead}</p>
          {!game ? (
            <p className="hint empty">{texts.noGames}</p>
          ) : (players.body?.players ?? []).length === 0 ? (
            <p className="hint empty">{texts.noPlayersOf}</p>
          ) : (
            <ul className="people">
              {(players.body?.players ?? []).map((card) => (
                <PersonRow key={card.user.userId} card={card} texts={texts} ui={t} now={now} />
              ))}
            </ul>
          )}
          {game && (
            <Link href={`/games/${game}`} className="pill hub-link">
              {texts.gameHub}
            </Link>
          )}
        </article>
      </div>
    </section>
  );
}
