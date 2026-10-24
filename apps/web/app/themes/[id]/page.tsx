import { Avatar } from "@/components/Avatar";
import { ProfileMenu } from "@/components/ProfileMenu";
import { ThemeLike, ThemeOwner } from "@/components/ThemeActions";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { currentUser, publicJson } from "@/lib/session";
import { type ThemeColors, type ThemeDetail, fileSize, isThemeId, themeStyle } from "@/lib/themes";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  if (!isThemeId(id)) return null;
  return (await publicJson<ThemeDetail>(`/themes/${id}`)).body;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const theme = await load((await params).id);
  if (!theme) return { title: "Themes · AnyTogether" };
  return {
    title: `${theme.name} · Themes · AnyTogether`,
    description:
      theme.description ?? `A theme for the AnyPS5 launcher by ${theme.maker?.displayName ?? "a player"}.`,
    openGraph:
      theme.status === "published"
        ? { images: [{ url: theme.preview, width: 1280, height: 720 }] }
        : undefined,
  };
}

/** One theme: its still, maker, colors and numbers, with Open in AnyPS5 and the file itself. */
export default async function Theme({ params }: Params) {
  const { id } = await params;
  const [texts, user, theme] = await Promise.all([strings(), currentUser(), load(id)]);
  if (!theme) notFound();
  const { language } = texts;
  const date = new Intl.DateTimeFormat(language, { dateStyle: "medium" });
  const number = new Intl.NumberFormat(language);
  const published = theme.status === "published";
  const styleName =
    theme.style === 0
      ? texts.style_0
      : theme.style === 1
        ? texts.style_1
        : theme.style === 2
          ? texts.style_2
          : fill(texts.styleOther, { n: theme.style });
  const colorNames: [keyof ThemeColors, string][] = [
    ["deep", texts.color_deep],
    ["middle", texts.color_middle],
    ["bright", texts.color_bright],
    ["accent", texts.color_accent],
  ];

  return (
    <section className="page theme-page" style={themeStyle(theme.colors)}>
      <nav className="crumbs in d1">
        <Link href="/themes">{texts.themes}</Link>
        {theme.mine && <Link href="/themes/mine">{texts.myThemes}</Link>}
      </nav>
      <div className="theme-hero in d1">
        {published && <img src={theme.preview} alt="" width={1280} height={720} />}
      </div>
      {theme.status !== "published" && (
        <p className="notice theme-status in d2">{texts[`status_${theme.status}`]}</p>
      )}

      <div className="theme-title in d2">
        <div className="lines">
          <h2>{theme.name}</h2>
          {theme.maker && (
            <Link href={`/u/${theme.maker.handle}`} className="who maker">
              <Avatar person={theme.maker} size={22} />
              <span className="meta">{fill(texts.byMaker, { name: theme.maker.displayName })}</span>
            </Link>
          )}
        </div>
        {user && !theme.mine && published && (
          <ProfileMenu
            person={{ userId: theme.id, displayName: theme.name }}
            texts={ui(texts)}
            kind="theme"
            lead={texts.reportThemeLead}
          />
        )}
      </div>

      {published && (
        <div className="theme-cta in d3">
          <a href={theme.open} className="primary open-button">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
            </svg>
            {texts.openInAnyPS5}
          </a>
          <a href={theme.download} className="pill" download>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
            {texts.downloadFile}
            <span className="meta">{fileSize(theme.size, language)}</span>
          </a>
          <ThemeLike
            id={theme.id}
            liked={theme.liked}
            likes={theme.likes}
            signedIn={Boolean(user) && !theme.mine}
            texts={ui(texts)}
          />
        </div>
      )}
      {published && <p className="hint-line in d3">{texts.openHint}</p>}

      {theme.description && (
        <article className="card in d3">
          <h3 className="sub">{texts.aboutTheme}</h3>
          <p className="theme-about">{theme.description}</p>
        </article>
      )}

      <article className="card in d4">
        <h3 className="sub">{texts.colors}</h3>
        <ul className="theme-colors">
          {colorNames.map(([key, label]) => (
            <li key={key}>
              <i style={{ background: theme.colors[key] }} />
              <span className="lines">
                <span className="name">{label}</span>
                <span className="meta">{theme.colors[key]}</span>
              </span>
            </li>
          ))}
        </ul>
      </article>

      <article className="card in d4">
        <h3 className="sub">{texts.details}</h3>
        <dl className="facts">
          <div>
            <dt>{texts.motion}</dt>
            <dd>
              {styleName}
              {theme.background && ` + ${theme.background === "video" ? texts.video : texts.picture}`}
            </dd>
          </div>
          <div>
            <dt>{texts.music}</dt>
            <dd>{theme.music ? "✓" : "–"}</dd>
          </div>
          <div>
            <dt>{texts.downloadsLabel}</dt>
            <dd>{number.format(theme.downloads)}</dd>
          </div>
          <div>
            <dt>{texts.version}</dt>
            <dd>{theme.version}</dd>
          </div>
          <div>
            <dt>{texts.updatedOn}</dt>
            <dd>{date.format(new Date(theme.updatedAt))}</dd>
          </div>
          <div>
            <dt>{texts.fileSize}</dt>
            <dd>{fileSize(theme.size, language)}</dd>
          </div>
          <div className="wide-fact">
            <dt>{texts.checksum}</dt>
            <dd className="hash">{theme.sha256}</dd>
          </div>
        </dl>
      </article>

      {theme.mine && <ThemeOwner theme={theme} texts={ui(texts)} />}
    </section>
  );
}
