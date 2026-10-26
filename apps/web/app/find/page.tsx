import { FilterSelect, LfgComposer, RefreshOn } from "@/components/Discover";
import { FindTabs, LfgCard, gameName } from "@/components/DiscoverCards";
import {
  type Discovery,
  type LfgGame,
  type LfgPage,
  type LfgPost,
  languageName,
  pickLanguages,
  purposes,
} from "@/lib/discover";
import { type LibraryGame, localName } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { apiJson, currentUser } from "@/lib/session";
import { titled } from "@/lib/titles";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const generateMetadata = () => titled((t) => t.findPlayers);

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The looking-for-group board: filters in the address, posts newest first, the reader's own posts
 *  with who wants in, and live redraws when the board changes. */
export default async function Find({ searchParams }: Search) {
  const query = await searchParams;
  const game = /^[A-Z]{4}[0-9]{5}$/.test(one(query.game) ?? "") ? (one(query.game) as string) : "";
  const purpose = purposes.find((p) => p === one(query.purpose)) ?? "";
  const language = /^[a-z]{2}$/.test(one(query.language) ?? "") ? (one(query.language) as string) : "";
  const now = one(query.now) === "1";
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/find");
  const params = new URLSearchParams();
  if (game) params.set("titleId", game);
  if (purpose) params.set("purpose", purpose);
  if (language) params.set("language", language);
  if (now) params.set("now", "1");
  const [board, boardGames, mine, discovery, library] = await Promise.all([
    apiJson<LfgPage>(`/lfg${params.size ? `?${params}` : ""}`),
    apiJson<{ games: LfgGame[] }>("/lfg/games"),
    apiJson<{ posts: LfgPost[]; asked: LfgPost[] }>("/me/lfg"),
    apiJson<Discovery>("/me/discovery"),
    apiJson<{ games: LibraryGame[] }>(`/users/${user.profile.handle}/library`),
  ]);
  const { language: lang } = texts;
  const t = ui(texts);
  const at = Date.now();
  const posts = board.body?.posts ?? [];
  const myPosts = (mine.body?.posts ?? []).filter((p) => p.status === "open" || p.status === "full");
  const onBoard = new Set(posts.map((p) => p.id));
  const asked = (mine.body?.asked ?? []).filter(
    (p) => !onBoard.has(p.id) && (p.myRequest?.status === "accepted" || p.status === "open"),
  );
  const others = posts.filter((p) => !p.mine);
  const filtered = Boolean(game || purpose || language || now);

  const gameOptions = new Map<string, string>();
  for (const g of boardGames.body?.games ?? []) gameOptions.set(g.titleId, gameName(g, g.titleId, lang));
  if (game && !gameOptions.has(game)) gameOptions.set(game, game);
  const composerGames = new Map<string, string>();
  for (const g of library.body?.games ?? [])
    composerGames.set(g.titleId, localName(g.names, lang) || g.titleId);
  for (const [id, name] of gameOptions) if (!composerGames.has(id)) composerGames.set(id, name);
  const defaultLanguages = discovery.body?.languages.length ? discovery.body.languages : [lang];
  const nowHref = (() => {
    const next = new URLSearchParams();
    if (game) next.set("game", game);
    if (purpose) next.set("purpose", purpose);
    if (language) next.set("language", language);
    if (!now) next.set("now", "1");
    return `/find${next.size ? `?${next}` : ""}`;
  })();

  return (
    <section className="page find">
      <RefreshOn
        topics={[game ? `lfg:${game}` : "lfg"]}
        events={["lfg.changed", "lfg.request", "lfg.request_cancelled", "lfg.answered"]}
      />
      <div className="find-head in d1">
        <h2>{texts.findPlayers}</h2>
        <LfgComposer
          texts={t}
          games={[...composerGames].map(([titleId, name]) => ({ titleId, name }))}
          defaultLanguages={defaultLanguages}
          defaultGame={game || undefined}
        />
      </div>
      <p className="lead in d2">{texts.findLead}</p>
      <FindTabs current="board" texts={texts} />

      <div className="find-filters in d3">
        <FilterSelect
          name="game"
          value={game}
          label={texts.filterGame}
          options={[["", texts.allGames], ...gameOptions]}
        />
        <FilterSelect
          name="purpose"
          value={purpose}
          label={texts.filterPurpose}
          options={[
            ["", texts.anything],
            ...purposes.map((p) => [p, texts[`purpose_${p}`]] as [string, string]),
          ]}
        />
        <FilterSelect
          name="language"
          value={language}
          label={texts.filterLanguage}
          options={[
            ["", texts.anyLanguage],
            ...[...new Set([...defaultLanguages, ...pickLanguages])].map(
              (code) => [code, languageName(code, lang)] as [string, string],
            ),
          ]}
        />
        <Link
          href={nowHref}
          className={`pill now-toggle${now ? " on" : ""}`}
          aria-pressed={now}
          scroll={false}
        >
          <i className="dot" />
          {texts.nowOnly}
        </Link>
      </div>

      {myPosts.length > 0 && (
        <div className="lfg-section in d3" id="mine">
          <h3 className="sub">
            {texts.yourPosts} <span className="n">{myPosts.length}</span>
          </h3>
          <div className="lfg-list">
            {myPosts.map((post) => (
              <LfgCard key={post.id} post={post} texts={texts} ui={t} now={at} />
            ))}
          </div>
        </div>
      )}

      <div className="lfg-section in d4">
        {(myPosts.length > 0 || asked.length > 0) && (
          <h3 className="sub">
            {texts.tabBoard} <span className="n">{others.length}</span>
          </h3>
        )}
        {others.length === 0 ? (
          <p className="card empty-card">{filtered ? texts.noPostsFiltered : texts.noPosts}</p>
        ) : (
          <div className="lfg-list">
            {others.map((post) => (
              <LfgCard key={post.id} post={post} texts={texts} ui={t} now={at} />
            ))}
          </div>
        )}
      </div>

      {asked.length > 0 && (
        <div className="lfg-section in d4">
          <h3 className="sub">
            {texts.yourRequests} <span className="n">{asked.length}</span>
          </h3>
          <div className="lfg-list">
            {asked.map((post) => (
              <LfgCard key={post.id} post={post} texts={texts} ui={t} now={at} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
