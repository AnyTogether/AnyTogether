import { CompatDelete, CompatForm } from "@/components/CompatForm";
import { CompatVerdict } from "@/components/CompatVerdict";
import {
  type CompatGame,
  type CompatReportView,
  compatPlatforms,
  isTitleId,
  platformNames,
} from "@/lib/compat";
import { ago, localName } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { currentUser, publicJson } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type Params = { params: Promise<{ titleId: string }> };
type Detail = CompatGame & { reports: CompatReportView[] };

async function load(titleId: string) {
  const id = decodeURIComponent(titleId).toUpperCase();
  if (!isTitleId(id)) return null;
  return (await publicJson<Detail>(`/compat/${id}`)).body;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const game = await load((await params).titleId);
  return { title: `${game?.name ?? game?.titleId ?? "Compatibility"} · Compatibility · AnyTogether` };
}

/** One game: its verdict on each platform and the reports behind it. */
export default async function CompatibilityGame({ params }: Params) {
  const [texts, user, game, releases] = await Promise.all([
    strings(),
    currentUser(),
    load((await params).titleId),
    publicJson<{ macos: { version: string } | null }>("/releases"),
  ]);
  if (!game) notFound();
  const { language } = texts;
  const name = localName(game.names, language) || game.titleId;

  return (
    <section className="page compat">
      <nav className="crumbs in d1">
        <Link href="/compatibility">{texts.compatibility}</Link>
      </nav>
      <div className="compat-title in d1">
        <span className="game-icon big" aria-hidden="true">
          {game.iconUrl ? <img src={game.iconUrl} alt="" /> : name.slice(0, 1)}
        </span>
        <div className="lines">
          <h2>{name}</h2>
          <span className="meta">{game.titleId}</span>
        </div>
      </div>

      <div className="verdict-grid in d2">
        {compatPlatforms.map((p) => (
          <CompatVerdict key={p} platform={p} summary={game.platforms[p]} texts={texts} wide />
        ))}
      </div>
      <p className="hint-line compat-lead in d2">{texts.verdictLead}</p>

      <article className="card in d3">
        <h3 className="sub">
          {texts.latestReports} <span className="n">{game.reports.length}</span>
        </h3>
        {game.reports.length === 0 ? (
          <p className="empty">{texts.noCompatReports}</p>
        ) : (
          <ul className="compat-reports">
            {game.reports.map((report) => (
              <li key={report.id}>
                <div className="report-head">
                  <span className={`verdict-status is-${report.status}`}>
                    <span className={`compat-dot is-${report.status}`} aria-hidden="true" />
                    {texts[`status_${report.status}`]}
                  </span>
                  <span className="tag">{platformNames[report.platform]}</span>
                  {report.mine && <span className="tag you-tag">{texts.yours}</span>}
                  <span className="meta report-when">{ago(report.createdAt, language)}</span>
                </div>
                <p className="meta report-facts">
                  {[
                    `${texts.launcher} ${report.launcherVersion}`,
                    report.engineVersion && `${texts.engine} ${report.engineVersion}`,
                    report.gameVersion && fill(texts.gameVersion, { version: report.gameVersion }),
                    report.machine,
                    report.os,
                    report.fpsAvg !== null && fill(texts.fps, { n: report.fpsAvg }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {report.note && <p className="report-note">{report.note}</p>}
                {report.mine && <CompatDelete id={report.id} label={texts.deleteReport} />}
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="card in d4" id="report">
        <h3 className="sub">{texts.reportGame}</h3>
        <p className="hint-line compat-lead">{texts.reportGameLead}</p>
        {user ? (
          <CompatForm
            texts={ui(texts)}
            game={{ titleId: game.titleId, name: game.name }}
            defaultVersion={releases.body?.macos?.version}
          />
        ) : (
          <Link href={`/login?next=/compatibility/${game.titleId}%23report`} className="pill">
            {texts.signInToReport}
          </Link>
        )}
      </article>
    </section>
  );
}
