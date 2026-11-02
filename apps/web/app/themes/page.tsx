import { ThemeTile } from "@/components/ThemeTile";
import { wide } from "@/components/site/fonts";
import { strings } from "@/lib/i18n";
import { pageMetadata } from "@/lib/product-page";
import { currentUser, publicJson } from "@/lib/session";
import { type ThemeColors, type ThemePage, type ThemeSort, themeSorts } from "@/lib/themes";
import type { Metadata } from "next";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const texts = await strings();
  return pageMetadata(`${texts.themes} · AnyTogether`, texts.themesLead, "/themes");
}

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
    <section className={`page hub-page site ${wide.variable}`}>
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

      <MakeOwn texts={texts} signedIn={Boolean(user)} palettes={list.slice(0, 4).map((t) => t.colors)} />
    </section>
  );
}

/** The launcher's three built-in looks (Cosmic, Aurora, Sunset) and a fourth, for the swatches
 *  when the gallery has fewer than four themes to lend its colours. */
const fallbackPalettes: ThemeColors[] = [
  { deep: "#05061a", middle: "#1b2a6b", bright: "#8fb0ff", accent: "#d4a6ff" },
  { deep: "#03140f", middle: "#0d4a3a", bright: "#5fe0b4", accent: "#8af0de" },
  { deep: "#1a0508", middle: "#6b1b22", bright: "#ff9a6b", accent: "#ffcf6b" },
  { deep: "#0b0b12", middle: "#2a2a3a", bright: "#d6d6e6", accent: "#ffffff" },
];

/** Under the gallery: Theme Studio lives in the launcher, so this says where, with a fan of paint
 *  swatches in the colours of the themes above. */
function MakeOwn({
  texts,
  signedIn,
  palettes,
}: {
  texts: Awaited<ReturnType<typeof strings>>;
  signedIn: boolean;
  palettes: ThemeColors[];
}) {
  const fan = [...palettes, ...fallbackPalettes].slice(0, 4);
  return (
    <article className="make-own in d4" aria-labelledby="make-own-title">
      <div className="make-own-text">
        <h3 id="make-own-title">{texts.makeOwnTitle}</h3>
        <p>{texts.makeOwnLead}</p>
        <div className="make-own-acts">
          <Link href="/download" className="pill accent">
            {texts.makeOwnGet}
          </Link>
          <Link href={signedIn ? "/themes/new" : "/login?next=/themes/new"} className="pill">
            {texts.makeOwnShare}
          </Link>
        </div>
      </div>
      <div className="make-own-fan" aria-hidden="true">
        {fan.map((colors, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: four fixed swatches
            key={index}
            className="swatch"
            style={
              {
                "--n": index,
                background: `linear-gradient(160deg, ${colors.bright}, ${colors.middle} 55%, ${colors.deep})`,
              } as React.CSSProperties
            }
          >
            <i style={{ background: colors.accent }} />
          </span>
        ))}
      </div>
    </article>
  );
}
