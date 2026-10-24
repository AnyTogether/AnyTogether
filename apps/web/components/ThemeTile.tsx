import type { Strings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { type ThemeCard, compact, themeStyle } from "@/lib/themes";
import Link from "next/link";

/** A theme in the gallery: its still over its own colors, its name, maker and numbers. */
export function ThemeTile({
  theme,
  texts,
  status,
}: {
  theme: ThemeCard;
  texts: Strings;
  /** The maker's own list shows a theme that is not published, without its still. */
  status?: "published" | "review" | "hidden";
}) {
  const { language } = texts;
  const shown = !status || status === "published";
  return (
    <li className="theme-tile" style={themeStyle(theme.colors)}>
      <Link href={`/themes/${theme.id}`} className="theme-link">
        <span className="theme-still">
          {shown && <img src={theme.thumb} alt="" width={640} height={360} loading="lazy" decoding="async" />}
          <span className="theme-badges">
            {theme.background === "video" && <span className="theme-badge">{texts.video}</span>}
            {theme.music && <span className="theme-badge">{texts.music}</span>}
          </span>
          {status && status !== "published" && (
            <span className={`tag theme-state is-${status}`}>{texts[`statusTag_${status}`]}</span>
          )}
        </span>
        <span className="theme-body">
          <span className="theme-name">{theme.name}</span>
          <span className="theme-meta">
            <span className="theme-maker">
              {theme.maker ? fill(texts.byMaker, { name: theme.maker.displayName }) : ""}
            </span>
            <span className="theme-swatches" aria-hidden="true">
              <i style={{ background: theme.colors.deep }} />
              <i style={{ background: theme.colors.middle }} />
              <i style={{ background: theme.colors.bright }} />
              <i style={{ background: theme.colors.accent }} />
            </span>
          </span>
          <span className="theme-numbers meta">
            <span title={fill(texts.downloadsCount, { n: theme.downloads })}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
              {compact(theme.downloads, language)}
            </span>
            <span title={fill(texts.likesCount, { n: theme.likes })}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
              </svg>
              {compact(theme.likes, language)}
            </span>
            <span className="visually-hidden">
              {fill(texts.downloadsCount, { n: theme.downloads })},{" "}
              {fill(texts.likesCount, { n: theme.likes })}
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}
