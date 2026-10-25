import { CopyButton } from "@/components/CopyButton";
import { installLine } from "@/lib/downloads";
import type { Chapter, Frame, ProductPage as Page, ProductStrings, ShotRef, Tag } from "@/lib/i18n-products";
import type { SiteStrings } from "@/lib/i18n-site";
import Link from "next/link";
import type { ReactNode } from "react";
import "@/app/motion.css";
import { Backdrop } from "./Backdrop";
import { Reveal } from "./Reveal";
import { BrowserFrame, MacFrame, PcFrame, PhoneFrame, Shot } from "./Shot";

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
  const href: Record<Key, string> = { mac: "/mac", pc: "/pc", phone: "/phone", together: "/together" };
  const names: Record<Key, [string, string]> = {
    mac: ["AnyPS5-ARM", s.landing.products[0]?.where ?? ""],
    pc: ["AnyPS5 Desktop", s.landing.products[1]?.where ?? ""],
    phone: ["AnyPS5 Remote", s.landing.products[2]?.where ?? ""],
    together: ["AnyTogether", s.landing.products[3]?.where ?? ""],
  };
  return (
    <div className={`site product-page is-${which}`}>
      <Reveal />
      <div className="p-top" data-parallax>
        <Backdrop look={looks[which]} glyphs="side" gain={0.78} className="p-backdrop" />
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
          <div className={`p-hero-art in d4${page.heroSide ? " with-side" : ""}`}>
            <Framed shot={page.hero} sizes="(max-width: 760px) 100vw, 640px" priority className="hero-main" />
            {page.heroSide && (
              <Framed shot={page.heroSide} sizes="(max-width: 760px) 50vw, 300px" className="hero-side" />
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
        <ChapterBlock key={chapter.id} chapter={chapter} index={index} s={s} />
      ))}

      <section className="install" id="install" data-reveal data-spot>
        <div>
          <p className="kicker">{p.installTitle}</p>
          <h2 className="h-section">{page.install.title}</h2>
          <div className="cta-row">{cta}</div>
        </div>
        <div className="install-body">
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
          <h3 className="meta">{p.requirements}</h3>
          <dl className="reqs">
            {page.install.requirements.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
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

function ChapterBlock({ chapter, index, s }: { chapter: Chapter; index: number; s: SiteStrings }) {
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
        <div className="gallery-wrap" data-reveal>
          <ul className="gallery">
            {chapter.gallery.map((shot) => (
              <li key={shot.name}>
                <figure>
                  <div className="g-shot">
                    <Shot name={shot.name} alt={shot.alt} sizes="(max-width: 760px) 80vw, 420px" />
                  </div>
                  <figcaption>{shot.caption}</figcaption>
                </figure>
              </li>
            ))}
          </ul>
          {chapter.galleryNote && <p className="fine-note">{chapter.galleryNote}</p>}
        </div>
      )}
    </section>
  );
}
