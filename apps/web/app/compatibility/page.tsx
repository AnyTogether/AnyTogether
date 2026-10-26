import { CompatForm } from "@/components/CompatForm";
import { CompatVerdict } from "@/components/CompatVerdict";
import { wide } from "@/components/site/fonts";
import {
  type CompatGame,
  type CompatSort,
  compatHref,
  compatPlatforms,
  compatQuery,
  compatSorts,
  compatStatuses,
  compatView,
  onlineWorks,
  platformNames,
} from "@/lib/compat";
import { localName } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { pageMetadata } from "@/lib/product-page";
import { currentUser, publicJson } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const texts = await strings();
  return pageMetadata(`${texts.compatibility} · AnyTogether`, texts.compatLead, "/compatibility");
}

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Every game someone reported, with its verdict per platform: filtered by platform, status and
 *  online play, sorted by the latest report, name or status, and searched; all of it in the
 *  address (compatView), so a view can be shared and the back button works. */
export default async function Compatibility({ searchParams }: Search) {
  const view = compatView(await searchParams);
  const { platform, status, online, sort, q, n: shown } = view;
  const params = compatQuery(view);
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
  const href = (change: Parameters<typeof compatHref>[1] = {}) => compatHref(view, change);
  const columns = platform ? [platform] : compatPlatforms;
  const filtered = Boolean(platform || status || online || q);
  const sortNames: Record<CompatSort, string> = {
    updated: texts.sortUpdated,
    name: texts.sortName,
    status: texts.sortStatus,
  };

  return (
    <section className={`page hub-page compat site ${wide.variable}`}>
      <div className="hub-head">
        <div>
          <h2 className="in d1">{texts.compatibility}</h2>
          <p className="lead in d2">{texts.compatLead}</p>
        </div>
      </div>

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
            {status && <input type="hidden" name="status" value={status} />}
            {online && <input type="hidden" name="online" value="works" />}
            {sort !== "updated" && <input type="hidden" name="sort" value={sort} />}
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

      {/* The statuses are the legend and the filter at once: each says what it means on hover. */}
      <section className="compat-filters in d3" aria-label={texts.filters}>
        <nav className="compat-chips" aria-label={texts.filterStatus}>
          <Link href={href({ status: null })} aria-current={!status ? "true" : undefined} className="chip">
            {texts.anyStatus}
          </Link>
          {compatStatuses.map((value) => (
            <Link
              key={value}
              href={href({ status: value === status ? null : value })}
              aria-current={value === status ? "true" : undefined}
              title={texts[`statusHint_${value}`]}
              className="chip"
            >
              <span className={`compat-dot is-${value}`} aria-hidden="true" />
              {texts[`status_${value}`]}
            </Link>
          ))}
          <span className="chip-gap" aria-hidden="true" />
          <Link
            href={href({ online: !online })}
            aria-current={online ? "true" : undefined}
            className="chip online-chip"
            title={texts.onlineBadgeHint}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="chip-icon">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M3.5 12h17M12 3.5c2.6 2.5 3.6 5.3 3.6 8.5s-1 6-3.6 8.5c-2.6-2.5-3.6-5.3-3.6-8.5s1-6 3.6-8.5z" />
            </svg>
            {texts.onlineWorksFilter}
          </Link>
        </nav>
        <nav className="seg compat-sort" aria-label={texts.sortBy}>
          {compatSorts.map((value) => (
            <Link key={value} href={href({ sort: value })} aria-current={value === sort ? "true" : undefined}>
              {sortNames[value]}
            </Link>
          ))}
        </nav>
      </section>

      <article className="card compat-list in d4">
        <h3 className="sub">
          {texts.compatibility} <span className="n">{fill(texts.gamesCount, { n: total })}</span>
          {filtered && (
            <Link
              href={compatHref({ ...view, platform: null, status: null, online: false, q: "", n: 50 })}
              className="quiet-link clear-filters"
            >
              {texts.clearFilters}
            </Link>
          )}
        </h3>
        {games.length === 0 ? (
          <p className="empty">
            {online && !status && !q
              ? texts.noOnlineGames
              : filtered
                ? texts.noGamesFound
                : texts.noCompatGames}
          </p>
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
                        <span className="meta">
                          {game.titleId}
                          {onlineWorks(game, columns) && (
                            <span className="online-badge" title={texts.onlineBadgeHint}>
                              {texts.onlineBadge}
                            </span>
                          )}
                        </span>
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
