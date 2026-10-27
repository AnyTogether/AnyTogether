import { PlatformIcon } from "@/components/site/Download";
import { PageHead } from "@/components/site/PageHead";
import { Reveal } from "@/components/site/Reveal";
import { Rich } from "@/components/site/Rich";
import { wide } from "@/components/site/fonts";
import { platformOrder } from "@/lib/downloads";
import { language } from "@/lib/i18n";
import { downloadPageStrings } from "@/lib/i18n-download";
import { helpStrings } from "@/lib/i18n-help";
import { siteStrings } from "@/lib/i18n-site";
import { plainText } from "@/lib/inline";
import { pageMetadata } from "@/lib/product-page";
import { visitorPlatform } from "@/lib/site";
import Link from "next/link";

export async function generateMetadata() {
  const h = helpStrings(await language());
  return pageMetadata(h.meta.title, h.meta.description, "/help");
}

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** Install guides for every platform, first steps, questions and troubleshooting, pointing to
 *  the user guide on GitHub for depth. */
export default async function Help() {
  const lang = await language();
  const [h, d, s, visitor] = [
    helpStrings(lang),
    downloadPageStrings(lang),
    siteStrings(lang),
    await visitorPlatform(),
  ];
  const order = visitor ? [visitor, ...platformOrder.filter((p) => p !== visitor)] : platformOrder;
  // The questions for search engines, as plain text (our own fixed texts, with < escaped).
  const faqData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: h.faq.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a.map(plainText).join(" ") },
    })),
  }).replace(/</g, "\\u003c");

  return (
    <div className={`site pg hp-page ${wide.variable}`}>
      <Reveal />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON of the page's own fixed texts, < escaped */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqData }} />
      <PageHead kicker={h.kicker} title={h.title} lead={h.lead}>
        <div className="pg-links">
          <a href={h.guideHref} className="text-link">
            {h.guide}
            <Arrow />
          </a>
        </div>
      </PageHead>

      <nav className="toc" aria-label={h.toc.label}>
        <span className="meta">{h.toc.label}</span>
        <ul>
          {(["install", "start", "faq", "trouble", "more"] as const).map((id) => (
            <li key={id}>
              <a href={`#${id}`}>{h.toc[id]}</a>
            </li>
          ))}
        </ul>
      </nav>

      <section className="pg-sec" id="install" aria-labelledby="install-title">
        <div data-reveal>
          <h2 className="h-card" id="install-title">
            {h.install.title}
          </h2>
          <p className="s-lead">{h.install.lead}</p>
        </div>
        <div className="hp-platforms">
          {order.map((platform) => (
            <article
              key={platform}
              className={`plat-card hp-plat${platform === visitor ? " current" : ""}`}
              aria-labelledby={`hp-${platform}`}
              data-reveal
            >
              <header>
                <PlatformIcon platform={platform} />
                <div>
                  <h3 id={`hp-${platform}`}>{s.platform[platform]}</h3>
                  <span className="plat-product">{d.products[platform]}</span>
                </div>
              </header>
              <ol className="install-steps">
                {d.guides[platform].steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="plat-req">
                <span className="pg-label">{h.install.needs}</span>{" "}
                {d.guides[platform].requirements
                  .slice(0, 2)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
              </p>
              <Link href={`/download#${platform}`} className="file-link hp-files">
                {h.install.files}
                <Arrow />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="pg-sec" id="start" aria-labelledby="start-title">
        <div data-reveal>
          <h2 className="h-card" id="start-title">
            {h.start.title}
          </h2>
        </div>
        <ol className="cards three hp-steps" data-reveal>
          {h.start.steps.map(([t, text]) => (
            <li key={t}>
              <h3>{t}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="pg-sec hp-faq" id="faq" aria-labelledby="faq-title">
        <div className="hp-faq-head" data-reveal>
          <h2 className="h-card" id="faq-title">
            {h.faq.title}
          </h2>
        </div>
        <div className="hp-qs" data-reveal>
          {h.faq.items.map((item) => (
            <details key={item.id} id={item.id} className="hp-q">
              <summary>
                <h3>{item.q}</h3>
              </summary>
              <div className="hp-a">
                {item.a.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)}>
                    <Rich text={paragraph} />
                  </p>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="pg-sec" id="trouble" aria-labelledby="trouble-title">
        <div data-reveal>
          <h2 className="h-card" id="trouble-title">
            {h.trouble.title}
          </h2>
        </div>
        <ul className="items hp-trouble" data-reveal>
          {h.trouble.items.map(([t, text]) => (
            <li key={t}>
              <h3>{t}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="l-final hp-more" id="more" data-reveal>
        <h2>{h.more.title}</h2>
        <p>{h.more.lead}</p>
        <div className="cta-row center">
          <a href={h.guideHref} className="cta primary">
            {h.more.guide}
          </a>
          <a
            href="https://github.com/AnyTogether/AnyPS5-ARM/issues/new?template=crash.yml"
            className="cta ghost"
          >
            {h.more.issue}
          </a>
          <Link href="/projects#contribute" className="cta ghost">
            {h.more.contribute}
          </Link>
        </div>
      </section>
    </div>
  );
}
