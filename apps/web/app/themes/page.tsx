import { ThemeTile } from "@/components/ThemeTile";
import { strings } from "@/lib/i18n";
import { currentUser, publicJson } from "@/lib/session";
import { type ThemePage, type ThemeSort, themeSorts } from "@/lib/themes";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Themes · AnyTogether",
  description: "Themes for the AnyPS5 launcher, made in its Theme Studio and shared by players.",
};

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The Theme Hub: every published theme, newest, most downloaded or most liked, with search. */
export default async function Themes({ searchParams }: Search) {
  const query = await searchParams;
  const sort = themeSorts.find((s) => s === one(query.sort)) ?? "new";
  const q = (one(query.q) ?? "").trim().slice(0, 60);
  // "Show more" asks for everything up to the next page, so the page stays one plain link.
  const shown = Math.min(Math.max(Number(one(query.n)) || 24, 24), 240);
  const [texts, user, page] = await Promise.all([
    strings(),
    currentUser(),
    publicJson<ThemePage>(`/themes?${new URLSearchParams({ sort, limit: "60", ...(q ? { q } : {}) })}`),
  ]);
  // Past 60, the rest comes in further pages of 60.
  let list = page.body?.themes ?? [];
  let next = page.body?.next ?? null;
  while (next && list.length < shown) {
    const more = await publicJson<ThemePage>(
      `/themes?${new URLSearchParams({ sort, limit: "60", cursor: next, ...(q ? { q } : {}) })}`,
    );
    list = [...list, ...(more.body?.themes ?? [])];
    next = more.body?.next ?? null;
  }
  const hasMore = list.length > shown || Boolean(next);
  list = list.slice(0, shown);
  const href = (change: { sort?: ThemeSort; n?: number }) => {
    const params = new URLSearchParams();
    const nextSort = change.sort ?? sort;
    if (nextSort !== "new") params.set("sort", nextSort);
    if (q) params.set("q", q);
    if (change.n) params.set("n", String(change.n));
    return `/themes${params.size ? `?${params}` : ""}`;
  };
  const sortName: Record<ThemeSort, string> = {
    new: texts.sortNew,
    popular: texts.sortPopular,
    liked: texts.sortLiked,
  };

  return (
    <section className="page hub-page">
      <div className="hub-head">
        <div>
          <h2 className="in d1">{texts.themes}</h2>
          <p className="lead in d2">{texts.themesLead}</p>
        </div>
        <div className="hub-actions in d2">
          {user && (
            <Link href="/themes/mine" className="pill">
              {texts.myThemes}
            </Link>
          )}
          <Link href={user ? "/themes/new" : "/login?next=/themes/new"} className="pill accent">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {texts.shareTheme}
          </Link>
        </div>
      </div>

      <div className="hub-controls in d3">
        <nav className="seg" aria-label={texts.themes}>
          {themeSorts.map((s) => (
            <Link key={s} href={href({ sort: s })} aria-current={s === sort ? "true" : undefined}>
              {sortName[s]}
            </Link>
          ))}
        </nav>
        <search className="hub-search-wrap">
          <form className="field hub-search" action="/themes">
            {sort !== "new" && <input type="hidden" name="sort" value={sort} />}
            <svg viewBox="0 0 24 24" aria-hidden="true" className="search-icon">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M20 20l-4.2-4.2" />
            </svg>
            <input
              type="search"
              name="q"
              defaultValue={q}
              maxLength={60}
              placeholder={texts.searchThemes}
              aria-label={texts.searchThemes}
            />
          </form>
        </search>
      </div>

      {list.length === 0 ? (
        <article className="card in d4">
          <p className="empty">{q ? texts.noThemesFound : texts.noThemes}</p>
        </article>
      ) : (
        <ul className="theme-grid in d4">
          {list.map((theme) => (
            <ThemeTile key={theme.id} theme={theme} texts={texts} />
          ))}
        </ul>
      )}
      {hasMore && (
        <div className="more-row">
          <Link href={href({ n: shown + 24 })} className="pill" scroll={false}>
            {texts.showMore}
          </Link>
        </div>
      )}
    </section>
  );
}
