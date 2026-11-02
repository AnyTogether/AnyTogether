import { CopyButton } from "@/components/CopyButton";
import { installLine } from "@/lib/downloads";
import { motionStrings } from "@/lib/i18n-motion";
import type {
  Chapter,
  Frame,
  GalleryShot,
  ProductPage as Page,
  ProductStrings,
  ShotRef,
  Tag,
} from "@/lib/i18n-products";
import { type SiteStrings, siteStrings } from "@/lib/i18n-site";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import "@/app/motion.css";
import "@/app/live.css";
import { shots } from "@/lib/shots";
import { Backdrop } from "./Backdrop";
import { LiveChat, LiveFriends, LivePad, LiveParty } from "./LiveBits";
import { LiveLauncher } from "./LiveLauncher";
import { Reveal } from "./Reveal";
import { BrowserFrame, MacFrame, PcFrame, PhoneFrame, Shot } from "./Shot";
import { Strip } from "./Strip";
import { SelfHostTerminal } from "./Terminal";
import { Zoom } from "./Zoom";
import { wide } from "./fonts";

type Key = "mac" | "pc" | "phone" | "together";

/** Each product wears one of the launcher's backgrounds; AnyTogether gets Cosmic in party colours. */
const looks = { mac: "cosmic", pc: "aurora", phone: "sunset", together: "party" } as const;

/** A picture in the frame its device calls for. */
export function Framed({
  shot,
  sizes,
  priority = false,
  className = "",
}: { shot: ShotRef; sizes: string; priority?: boolean; className?: string }) {
  const picture = <Shot name={shot.name} alt={shot.alt} sizes={sizes} priority={priority} />;
  const frames: Record<Frame, (child: ReactNode) => ReactNode> = {
    mac: (child) => <MacFrame className={className}>{child}</MacFrame>,
    pc: (child) => <PcFrame className={className}>{child}</PcFrame>,
    phone: (child) => <PhoneFrame className={className}>{child}</PhoneFrame>,
    browser: (child) => <BrowserFrame className={className}>{child}</BrowserFrame>,
    tall: (child) => (
      <figure className={`device tall ${className}`}>
        <div className="screen">{child}</div>
      </figure>
    ),
    plain: (child) => (
      <figure className={`device plain ${className}`}>
        <div className="screen">{child}</div>
      </figure>
    ),
  };
  return <>{frames[shot.frame](picture)}</>;
}

export function TagChip({ tag, s }: { tag: Tag; s: SiteStrings }) {
  return <span className={`chip-tag ${tag}`}>{tag === "preview" ? s.preview : s.experimental}</span>;
}

/** One of the product pages: the hero, a row of facts, every chapter with its pictures and its full
 *  list of features, the install steps, and the other products. */
export function ProductPage({
  page,
  which,
  p,
  s,
  cta,
}: {
  page: Page;
  which: Key;
  p: ProductStrings;
  s: SiteStrings;
  /** The page's download buttons. */
  cta: ReactNode;
}) {
  const others = (["mac", "pc", "phone", "together"] as Key[]).filter((k) => k !== which);
  const language = s === siteStrings("tr") ? "tr" : "en";
  const m = motionStrings(language);
  const href: Record<Key, string> = { mac: "/mac", pc: "/pc", phone: "/phone", together: "/together" };
  const names: Record<Key, [string, string]> = {
    mac: ["AnyPS5 ARM", s.landing.products[0]?.where ?? ""],
    pc: ["AnyPS5 Desktop", s.landing.products[1]?.where ?? ""],
    phone: ["AnyPS5 Remote", s.landing.products[2]?.where ?? ""],
    together: ["AnyTogether", s.landing.products[3]?.where ?? ""],
  };
  return (
    <div className={`site product-page is-${which} ${wide.variable}`}>
      <Reveal />
      <div className="p-top" data-parallax>
        <Backdrop look={looks[which]} gain={0.78} className="p-backdrop" />
        <section className="p-hero">
          <div className="p-hero-text">
            <p className="kicker in d1" lang="en">
              {page.kicker}
              {page.tag && <TagChip tag={page.tag} s={s} />}
            </p>
            <h1 className="p-title in d2">
              {page.title[0]}
              <br />
              <span className="ink-soft">{page.title[1]}</span>
            </h1>
            <p className="p-lead in d3">{page.lead}</p>
            <div className="cta-row in d3">{cta}</div>
          </div>
          <div className={`p-hero-art live in d4 hero-${which}`}>
            {(which === "mac" || which === "pc") && (
              <div className="hero-main">
                <LiveLauncher
                  t={m.launcher}
                  language={language}
                  label={page.hero.alt}
                  unlocking={which === "mac"}
                />
              </div>
            )}
            {which === "phone" && (
              <div className="hero-main" role="img" aria-label={page.hero.alt}>
                <LivePad user={m.launcher.user} />
              </div>
            )}
            {which === "together" && (
              <div className="hero-main hero-stack" role="img" aria-label={page.hero.alt}>
                <LiveParty t={m.party} />
                <LiveChat t={m.chat} />
                <LiveFriends t={m.friends} />
              </div>
            )}
          </div>
        </section>
      </div>

      <dl className="p-facts" data-reveal>
        {page.facts.map(([value, label]) => (
          <div key={label}>
            <dt data-count="">{value}</dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>

      <nav className="toc" aria-label={p.onThisPage}>
        <span className="meta">{p.onThisPage}</span>
        <ul>
          {page.chapters.map((chapter) => (
            <li key={chapter.id}>
              <a href={`#${chapter.id}`}>{chapter.nav}</a>
            </li>
          ))}
          <li>
            <a href="#install">{p.installTitle}</a>
          </li>
        </ul>
      </nav>

      {page.chapters.map((chapter, index) => (
        <ChapterBlock key={chapter.id} chapter={chapter} index={index} s={s} p={p} />
      ))}

      <section className="install" id="install" data-reveal data-spot>
        <div>
          <p className="kicker">{p.installTitle}</p>
          <h2 className="h-section">{page.install.title}</h2>
          <div className="cta-row">{cta}</div>
        </div>
        <div className="install-body">
          {which === "together" ? (
            <>
              <SelfHostTerminal guide={s.landing.open.guide} />
              {page.install.steps.map((step) => (
                <p key={step} className="install-note">
                  {step}
                </p>
              ))}
            </>
          ) : (
            <>
              {which === "mac" && (
                <div className="term-line install-command">
                  <code>{installLine}</code>
                  <CopyButton text={installLine} label={s.copy} done={s.copied} />
                </div>
              )}
              <ol className="install-steps">
                {page.install.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {page.install.requirements.length > 0 && (
                <>
                  <h3 className="meta">{p.requirements}</h3>
                  <dl className="reqs">
                    {page.install.requirements.map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </>
          )}
        </div>
      </section>

      <section className="family" data-reveal>
        <p className="kicker">{p.family}</p>
        <div className="family-row">
          {others.map((key) => (
            <Link key={key} href={href[key]} className="family-card" data-spot>
              <b>{names[key][0]}</b>
              <span>{names[key][1]}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChapterBlock({
  chapter,
  index,
  s,
  p,
}: { chapter: Chapter; index: number; s: SiteStrings; p: ProductStrings }) {
  const [first, ...rest] = chapter.shots;
  return (
    <section className={`chapter${index % 2 ? " flip" : ""}${first ? "" : " no-art"}`} id={chapter.id}>
      <div className="chapter-head" data-reveal>
        <p className="kicker">
          <span className="num">{String(index + 1).padStart(2, "0")}</span>
          {chapter.kicker}
        </p>
        <h2 className="h-section">{chapter.title}</h2>
        <p className="s-lead">{chapter.lead}</p>
      </div>
      {first && (
        <div className={`chapter-art${rest.length ? " pair" : ""}`} data-reveal>
          <Framed shot={first} sizes="(max-width: 760px) 100vw, 620px" />
          {rest.map((shot) => (
            <Framed key={shot.name} shot={shot} sizes="(max-width: 760px) 100vw, 620px" />
          ))}
        </div>
      )}
      <ul className="items" data-reveal>
        {chapter.items.map((item) => (
          <li key={item.t}>
            <h3>
              {item.t}
              {item.tag && <TagChip tag={item.tag} s={s} />}
            </h3>
            <p>{item.d}</p>
          </li>
        ))}
      </ul>
      {chapter.gallery && (
        <div
          className="gallery-wrap"
          data-reveal
          style={{ "--shot-ratio": rowRatio(chapter.gallery) } as CSSProperties}
        >
          {chapter.gallery.length >= 3 ? (
            <Strip label={chapter.title}>
              {chapter.gallery.map((shot) => (
                <GalleryFigure key={shot.name} shot={shot} />
              ))}
            </Strip>
          ) : (
            // One or two pictures sit small under the chapter, so each opens large.
            <div className="gallery">
              {chapter.gallery.map((shot) => (
                <GalleryFigure key={shot.name} shot={shot} zoom={p} />
              ))}
            </div>
          )}
          {chapter.galleryNote && <p className="fine-note">{chapter.galleryNote}</p>}
        </div>
      )}
    </section>
  );
}

/** The shape most pictures of a row have ("16 / 9"): the row draws every picture in it. */
export function rowRatio(gallery: GalleryShot[]): string {
  const count = new Map<string, number>();
  for (const shot of gallery) {
    const { w, h } = shots[shot.name];
    const ratio = `${w} / ${h}`;
    count.set(ratio, (count.get(ratio) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "auto";
}

function GalleryFigure({ shot, zoom }: { shot: GalleryShot; zoom?: ProductStrings }) {
  const picture = <Shot name={shot.name} alt={shot.alt} sizes="(max-width: 760px) 80vw, 420px" />;
  return (
    <figure className="g-item">
      <div className="g-shot">
        {zoom ? (
          <Zoom
            label={zoom.enlarge.replace("{caption}", shot.caption)}
            close={zoom.close}
            caption={shot.caption}
            large={<Shot name={shot.name} alt={shot.alt} sizes="92vw" />}
          >
            {picture}
          </Zoom>
        ) : (
          picture
        )}
      </div>
      <figcaption>{shot.caption}</figcaption>
    </figure>
  );
}
