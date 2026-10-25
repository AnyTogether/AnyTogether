import { CompatForm } from "@/components/CompatForm";
import { CompatVerdict } from "@/components/CompatVerdict";
import { wide } from "@/components/site/fonts";
import {
  type CompatGame,
  type CompatPlatform,
  compatPlatforms,
  compatStatuses,
  platformNames,
} from "@/lib/compat";
import { localName } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { currentUser, publicJson } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Compatibility · AnyTogether",
  description: "How far each PS5 game gets in AnyPS5 on macOS, Windows and Linux, as players report it.",
};

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Every game someone reported, newest report first, with its verdict per platform. */
export default async function Compatibility({ searchParams }: Search) {
  const query = await searchParams;
  const platform = compatPlatforms.find((p) => p === one(query.platform));
  const q = (one(query.q) ?? "").trim().slice(0, 80);
  const shown = Math.min(Math.max(Number(one(query.n)) || 50, 50), 500);
  const params = new URLSearchParams({
    limit: "100",
    ...(q ? { q } : {}),
    ...(platform ? { platform } : {}),
  });
  const [texts, user, first, releases] = await Promise.all([
    strings(),
    currentUser(),
    publicJson<{ games: CompatGame[]; total: number; next: string | null }>(`/compat?${params}`),
    publicJson<{ macos: { version: string } | null }>("/releases"),
  ]);
  let games = first.body?.games ?? [];
  let next = first.body?.next ?? null;
  while (next && games.length < shown) {
    params.set("cursor", next);
    const more = await publicJson<{ games: CompatGame[]; next: string | null }>(`/compat?${params}`);
    games = [...games, ...(more.body?.games ?? [])];
    next = more.body?.next ?? null;
  }
  const total = first.body?.total ?? 0;
  const hasMore = games.length > shown || Boolean(next);
  games = games.slice(0, shown);
  const href = (change: { platform?: CompatPlatform | null; n?: number }) => {
    const out = new URLSearchParams();
    const p = change.platform === undefined ? platform : change.platform;
    if (p) out.set("platform", p);
    if (q) out.set("q", q);
    if (change.n) out.set("n", String(change.n));
    return `/compatibility${out.size ? `?${out}` : ""}`;
  };
  const columns = platform ? [platform] : compatPlatforms;

  return (
    <section className={`page hub-page compat site ${wide.variable}`}>
      <div className="hub-head">
        <div>
          <h2 className="in d1">{texts.compatibility}</h2>
          <p className="lead in d2">{texts.compatLead}</p>
        </div>
      </div>

      <ul className="compat-legend in d2" aria-label={texts.howFar}>
        {compatStatuses.map((status) => (
          <li key={status} title={texts[`statusHint_${status}`]}>
            <span className={`compat-dot is-${status}`} aria-hidden="true" />
            {texts[`status_${status}`]}
          </li>
        ))}
      </ul>

      <div className="hub-controls in d3">
        <nav className="seg" aria-label={texts.platform}>
          <Link href={href({ platform: null })} aria-current={!platform ? "true" : undefined}>
            {texts.allPlatforms}
          </Link>
          {compatPlatforms.map((p) => (
            <Link key={p} href={href({ platform: p })} aria-current={p === platform ? "true" : undefined}>
              {platformNames[p]}
            </Link>
          ))}
        </nav>
        <search className="hub-search-wrap">
          <form className="field hub-search" action="/compatibility">
            {platform && <input type="hidden" name="platform" value={platform} />}
            <svg viewBox="0 0 24 24" aria-hidden="true" className="search-icon">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M20 20l-4.2-4.2" />
            </svg>
            <input
              type="search"
              name="q"
              defaultValue={q}
              maxLength={80}
              placeholder={texts.searchGames}
              aria-label={texts.searchGames}
            />
          </form>
        </search>
      </div>

      <article className="card compat-list in d4">
        <h3 className="sub">
          {texts.compatibility} <span className="n">{fill(texts.gamesCount, { n: total })}</span>
        </h3>
        {games.length === 0 ? (
          <p className="empty">{q || platform ? texts.noGamesFound : texts.noCompatGames}</p>
        ) : (
          <ul className="compat-rows">
            {games.map((game) => {
              const name = localName(game.names, texts.language) || game.titleId;
              return (
                <li key={game.titleId}>
                  <Link href={`/compatibility/${game.titleId}`} className="compat-row">
                    <span className="compat-game">
                      <span className="game-icon" aria-hidden="true">
                        {game.iconUrl ? <img src={game.iconUrl} alt="" loading="lazy" /> : name.slice(0, 1)}
                      </span>
                      <span className="lines">
                        <span className="name">{name}</span>
                        <span className="meta">{game.titleId}</span>
                      </span>
                    </span>
                    <span className={`compat-verdicts n${columns.length}`}>
                      {columns.map((p) => (
                        <CompatVerdict key={p} platform={p} summary={game.platforms[p]} texts={texts} />
                      ))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {hasMore && (
          <div className="more-row">
            <Link href={href({ n: shown + 50 })} className="pill" scroll={false}>
              {texts.showMore}
            </Link>
          </div>
        )}
      </article>

      <article className="card in d4" id="report">
        <h3 className="sub">{texts.reportGame}</h3>
        <p className="hint-line compat-lead">{texts.reportGameLead}</p>
        {user ? (
          <CompatForm texts={ui(texts)} defaultVersion={releases.body?.macos?.version} />
        ) : (
          <Link href="/login?next=/compatibility%23report" className="pill">
            {texts.signInToReport}
          </Link>
        )}
      </article>
    </section>
  );
}
