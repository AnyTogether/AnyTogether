import {
  type Platform,
  type PublicStats,
  type Releases,
  platformOrder,
  statsWorthShowing,
} from "@/lib/downloads";
import { motionStrings } from "@/lib/i18n-motion";
import type { SiteStrings } from "@/lib/i18n-site";
import { fill } from "@/lib/people";
import Link from "next/link";
import type { CSSProperties } from "react";
import "@/app/motion.css";
import "@/app/live.css";
import { Backdrop, GlyphShape } from "./Backdrop";
import { DownloadCta, PlatformCard, PlatformIcon } from "./Download";
import { LiveBoard, LiveCall, LiveChat, LiveFriends, LivePad, LiveParty, TrophyToast } from "./LiveBits";
import { LiveLauncher } from "./LiveLauncher";
import { LiveShare } from "./LiveShare";
import { LookSwitch } from "./LookSwitch";
import { Reveal } from "./Reveal";
import { Shot } from "./Shot";
import { wide } from "./fonts";

const productHref: Record<string, string> = {
  mac: "/mac",
  pc: "/pc",
  phone: "/phone",
  together: "/together",
};

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** What signed-out visitors see at /: the AnyPS5 family, shown working rather than described. The
 *  launcher, share play, the phone pad, the party and the board are rebuilt live in HTML; real
 *  pictures appear inside them or beside them. */
export function Landing({
  s,
  language,
  platform,
  releases,
  stats,
}: {
  s: SiteStrings;
  language: string;
  platform: Platform | null;
  releases: Releases | null;
  stats: PublicStats | null;
}) {
  const l = s.landing;
  const m = motionStrings(language);
  const shownStats = statsWorthShowing(stats);
  const number = new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 });
  const others = platformOrder.filter((p) => p !== platform);
  const version = releases?.macos?.version;
  const [friendsCard, messagesCard, partyCard, callsCard] = l.social.cards;
  return (
    <div className={`site landing ${wide.variable}`}>
      <Reveal />
      <div className="l-top" data-parallax>
        <Backdrop look="cosmic" gain={0.95} className="hero-backdrop" />
        <section className="l-hero">
          {version && releases?.macos && (
            <a href={releases.macos.url} className="release in d1">
              <i className="dot" />
              {fill(l.released, { version })}
              <span className="release-more">
                {l.whatsNew}
                <Arrow />
              </span>
            </a>
          )}
          <h1 className="l-title">
            <span className="line">{l.heroA}</span>
            <span className="line">{l.heroB}</span>
            <span className="line accent">{l.heroC}</span>
          </h1>
          <div className="l-hero-foot">
            <p className="l-lead in d3">{l.lead}</p>
            <div className="l-hero-act in d3">
              <div className="cta-row">
                <DownloadCta platform={platform} releases={releases} s={s} language={language} />
                <Link href="/login" className="cta ghost">
                  {s.nav.createAccount}
                </Link>
              </div>
              <p className="hero-note">
                <span>{l.heroNote[platform ?? "none"]}</span>
                {platform && (
                  <span className="also">
                    {l.alsoOn}{" "}
                    {others.map((p, i) => (
                      <span key={p}>
                        <a href="#platforms">{s.platform[p]}</a>
                        {i < others.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </span>
                )}
              </p>
            </div>
          </div>
        </section>

        <div className="hero-stage in d4">
          <div className="stage-tilt">
            <LiveLauncher t={m.launcher} language={language} label={l.heroAlt} />
          </div>
        </div>
      </div>

      <nav className="family-strip" aria-label={l.family} data-reveal data-loop>
        <span className="wire" aria-hidden="true" />
        {l.products.map((product) => (
          <Link
            key={product.key}
            href={productHref[product.key] ?? "/"}
            className={`fam ${product.key}`}
            data-spot
          >
            <span className="fam-where" lang="en">
              {product.where}
            </span>
            <b>{product.name}</b>
            <span className="fam-line">{product.line}</span>
            <Arrow />
          </Link>
        ))}
      </nav>

      {shownStats.length > 0 && stats && (
        <section className="live-stats" aria-label={l.statsLabel} data-reveal>
          <p className="stats-label">
            <i className="dot" />
            {l.statsLabel}
          </p>
          <dl>
            {shownStats.map((key) => (
              <div key={key}>
                <dt data-count={stats[key]} data-compact>
                  {number.format(stats[key])}
                </dt>
                <dd>{l.stats[key]}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="l-sec l-share" id="share-play">
        <div className="share-head" data-reveal>
          <h2 className="h-section">{l.share.title}</h2>
          <p className="s-lead">{l.share.lead}</p>
        </div>
        <div data-reveal>
          <LiveShare t={m.share} s={l.share} />
        </div>
        <div className="share-foot" data-reveal>
          <ul className="points">
            {l.share.points.map(([title, detail]) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{detail}</p>
              </li>
            ))}
          </ul>
          <p className="proof">
            {l.share.proof} <Link href="/together#share">{l.share.proofMore}</Link>
          </p>
        </div>
      </section>

      <section className="l-sec l-phone">
        <div className="phone-head" data-reveal>
          <h2 className="h-section">{l.phone.title}</h2>
          <p className="s-lead">{l.phone.lead}</p>
        </div>
        <div className="phone-stage" data-reveal>
          <ul className="phone-chips left">
            {l.phone.chips.slice(0, 4).map((chip) => (
              <li key={chip}>{chip}</li>
            ))}
          </ul>
          <div className="phone-center">
            <LivePad user={m.launcher.user} />
            <figure className="remote-play">
              <Shot name="phone-live-silksong" alt={l.phone.liveAlt} sizes="(max-width: 760px) 50vw, 300px" />
            </figure>
          </div>
          <ul className="phone-chips right">
            {l.phone.chips.slice(4).map((chip) => (
              <li key={chip}>{chip}</li>
            ))}
          </ul>
        </div>
        <p className="phone-more" data-reveal>
          <Link href="/phone" className="text-link">
            {l.phone.more}
            <Arrow />
          </Link>
        </p>
      </section>

      <section className="l-sec l-social">
        <div className="social-head" data-reveal>
          <h2 className="h-section">{l.social.title}</h2>
          <p className="s-lead">{l.social.lead}</p>
        </div>
        <div className="bento" data-reveal>
          <article className="cell c-party" data-spot>
            <LiveParty t={m.party} />
            {partyCard && (
              <div className="cell-text">
                <h3>{partyCard[0]}</h3>
                <p>{partyCard[1]}</p>
              </div>
            )}
          </article>
          <article className="cell c-chat" data-spot>
            <LiveChat t={m.chat} />
            {messagesCard && (
              <div className="cell-text">
                <h3>{messagesCard[0]}</h3>
                <p>{messagesCard[1]}</p>
              </div>
            )}
          </article>
          <article className="cell c-friends" data-spot>
            <LiveFriends t={m.friends} />
            {friendsCard && (
              <div className="cell-text">
                <h3>{friendsCard[0]}</h3>
                <p>{friendsCard[1]}</p>
              </div>
            )}
          </article>
          <article className="cell c-call" data-spot>
            <div className="call-stage">
              <LiveCall t={m.call} />
            </div>
            {callsCard && (
              <div className="cell-text">
                <h3>{callsCard[0]}</h3>
                <p>{callsCard[1]}</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="l-sec l-find">
        <div className="find-text" data-reveal>
          <h2 className="h-section">{l.find.title}</h2>
          <dl className="find-list">
            {l.find.cards.map(([title, detail]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
          <Link href="/find" className="text-link">
            {l.find.cta}
            <Arrow />
          </Link>
        </div>
        <div data-reveal>
          <LiveBoard t={m.board} cta={m.boardIn} />
        </div>
      </section>

      <section className="l-sec l-progress">
        <div className="progress-head" data-reveal>
          <h2 className="h-section">{l.progress.title}</h2>
          <p className="s-lead">{l.progress.lead}</p>
        </div>
        <div className="progress-art" data-reveal>
          <figure className="shot-plain pr-main">
            <Shot name="mac-profile" alt={l.progress.profileAlt} sizes="(max-width: 760px) 92vw, 820px" />
          </figure>
          <figure className="shot-plain pr-board">
            <Shot name="mac-leaderboard" alt={l.progress.boardAlt} sizes="(max-width: 760px) 60vw, 380px" />
          </figure>
          <TrophyToast t={m.trophy} />
        </div>
        <dl className="progress-facts" data-reveal>
          {l.progress.cards.map(([title, detail]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
        <p className="fine-note">{s.demoPeople}</p>
      </section>

      <section className="l-sec l-duo">
        <article className="duo-card themes" data-reveal data-spot>
          <Backdrop look="cosmic" className="duo-backdrop" gain={0.9} base={0.8} switchable />
          <div className="duo-text">
            <h2 className="h-card">{l.themes.title}</h2>
            <p>{l.themes.lead}</p>
            <LookSwitch t={m.looks} />
            <Link href="/themes" className="text-link">
              {l.themes.cta}
              <Arrow />
            </Link>
          </div>
        </article>
        <article className="duo-card framegen" data-reveal data-spot>
          <div className="duo-text">
            <p className="duo-tag">
              <span className="chip-tag experimental">{s.experimental}</span>
            </p>
            <h2 className="h-card">{l.framegen.title}</h2>
            <p>{l.framegen.lead}</p>
          </div>
          <div className="frames" aria-hidden="true">
            <div className="frame-row">
              <span className="frame-label">60 · {l.framegen.from}</span>
              <div className="ticks">
                {Array.from({ length: 16 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of marks
                  <i key={i} className={i % 2 ? "gap" : ""} style={{ "--i": i } as CSSProperties} />
                ))}
              </div>
            </div>
            <div className="frame-row">
              <span className="frame-label">120 · {l.framegen.to}</span>
              <div className="ticks">
                {Array.from({ length: 16 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of marks
                  <i key={i} className={i % 2 ? "made" : ""} style={{ "--i": i } as CSSProperties} />
                ))}
              </div>
            </div>
            <p className="frame-legend">
              <span>
                <i className="sw game" />
                {l.framegen.legendGame}
              </span>
              <span>
                <i className="sw made" />
                {l.framegen.legendMade}
              </span>
            </p>
          </div>
        </article>
      </section>

      <section className="l-sec l-platforms" id="platforms">
        <div className="platforms-head" data-reveal>
          <h2 className="h-section">{l.platforms.title}</h2>
          <p className="s-lead">{l.platforms.lead}</p>
        </div>
        <div className="plat-grid">
          {platformOrder.map((p) => (
            <PlatformCard
              key={p}
              platform={p}
              releases={releases}
              s={s}
              language={language}
              current={p === platform}
            />
          ))}
          <article className="plat-card web" data-reveal>
            <header>
              <PlatformIcon platform="web" />
              <div>
                <h3>{l.platforms.web}</h3>
                <Link href="/together" className="plat-product">
                  {l.platforms.webProduct}
                </Link>
              </div>
            </header>
            <p className="plat-req">{l.platforms.webReq}</p>
            <ul className="plat-files">
              <li>
                <Link href="/login" className="file-link">
                  <span>{s.nav.createAccount}</span>
                </Link>
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section className="l-sec l-open">
        <div className="sec-text" data-reveal>
          <h2 className="h-section">{l.open.title}</h2>
          <p className="s-lead">{l.open.lead}</p>
          <ul className="repos">
            {l.open.repos.map(([name, repo, license, what]) => (
              <li key={repo}>
                <a href={`https://github.com/${repo}`}>
                  <b>{name}</b>
                  <span className="lic">{license}</span>
                  <span className="what">{what}</span>
                  <Arrow />
                </a>
              </li>
            ))}
          </ul>
          <p className="fine-note">
            {l.open.built.split("{link}")[0]}
            <a href="https://github.com/boykopovar/AnyPS5">boykopovar/AnyPS5</a>
            {l.open.built.split("{link}")[1]}
          </p>
        </div>
        <div className="terminal" data-reveal>
          <pre>
            <code>
              <span className="ln" style={{ "--i": 0 } as CSSProperties}>
                <span className="c"># {l.open.guide}</span>
              </span>
              {"\n"}
              <span className="ln" style={{ "--i": 1 } as CSSProperties}>
                <span className="p">$</span> git clone https://github.com/utkuhalis/AnyTogether.git
              </span>
              {"\n"}
              <span className="ln" style={{ "--i": 2 } as CSSProperties}>
                <span className="p">$</span> cd AnyTogether/deploy && cp .env.example .env
              </span>
              {"\n"}
              <span className="ln" style={{ "--i": 3 } as CSSProperties}>
                <span className="p">$</span> docker compose up -d --build
              </span>
              {"\n"}
              <span className="ln" style={{ "--i": 4 } as CSSProperties}>
                <span className="ok">✓</span> caddy · web · api · realtime · postgres · valkey
                <i className="caret" />
              </span>
            </code>
          </pre>
          <a
            href="https://github.com/utkuhalis/AnyTogether/blob/main/docs/self-hosting.md"
            className="text-link"
          >
            {l.open.guide}
            <Arrow />
          </a>
        </div>
      </section>

      <section className="l-sec l-rules" data-reveal>
        <h2 className="rules-title">{l.rules.title}</h2>
        <ol className="rules">
          {l.rules.points.map(([title, detail]) => (
            <li key={title}>
              <h3>{title}</h3>
              <p>{detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="l-final" data-reveal data-loop>
        <Backdrop look="cosmic" className="final-backdrop" gain={0.85} />
        <div className="face" aria-hidden="true">
          {(["triangle", "circle", "cross", "square"] as const).map((shape) => (
            <span key={shape} className={`face-btn ${shape}`}>
              <GlyphShape shape={shape} />
            </span>
          ))}
        </div>
        <h2>{l.final.title}</h2>
        <p>{l.final.lead}</p>
        <div className="cta-row center">
          <DownloadCta platform={platform} releases={releases} s={s} language={language} />
          <Link href="/login" className="cta ghost">
            {s.nav.createAccount}
          </Link>
        </div>
      </section>
    </div>
  );
}
