import { PageHead } from "@/components/site/PageHead";
import { Reveal } from "@/components/site/Reveal";
import { wide } from "@/components/site/fonts";
import { language } from "@/lib/i18n";
import { developerStrings } from "@/lib/i18n-developers";
import { pageMetadata } from "@/lib/product-page";
import Link from "next/link";

export async function generateMetadata() {
  const d = developerStrings(await language());
  return pageMetadata(d.meta.title, d.meta.description, "/developers");
}

const spec = "/api/v1/public/openapi.json";
const example = `curl https://anytogether.net/api/v1/public/leaderboards/points?limit=10 \\
  -H "Authorization: Bearer atp_…"`;

/** The public API in short: getting a token, what it reads, the limits and the endpoints, with
 *  the OpenAPI document for the rest. */
export default async function Developers() {
  const d = developerStrings(await language());
  return (
    <div className={`site pg dev-page ${wide.variable}`}>
      <Reveal />
      <PageHead kicker={d.kicker} title={d.title} lead={d.lead} />

      <section className="pg-sec" aria-label={d.kicker}>
        <ol className="cards three dev-cards" data-reveal>
          {d.cards.map((card) => (
            <li key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="pg-sec" id="endpoints" aria-labelledby="endpoints-title">
        <div data-reveal>
          <h2 className="h-card" id="endpoints-title">
            {d.endpointsTitle}
          </h2>
          <p className="s-lead">{d.endpointsLead}</p>
        </div>
        <ul className="dev-endpoints" data-reveal>
          {d.endpoints.map((endpoint) => (
            <li key={endpoint.path}>
              <code className="dev-path">
                <span className="dev-verb">GET</span>
                {endpoint.path}
              </code>
              <span className="dev-text">{endpoint.text}</span>
              <span className="dev-scope">{endpoint.scope || d.noScope}</span>
            </li>
          ))}
        </ul>
        <figure className="dev-example" data-reveal>
          <figcaption className="pg-label">{d.exampleTitle}</figcaption>
          <pre>
            <code>{example}</code>
          </pre>
        </figure>
      </section>

      <section className="l-final" data-reveal>
        <h2>{d.final.title}</h2>
        <p>{d.final.lead}</p>
        <div className="cta-row center">
          <Link href="/settings#api" className="cta primary">
            {d.final.token}
          </Link>
          <a href={spec} className="cta ghost">
            {d.final.spec}
          </a>
        </div>
      </section>
    </div>
  );
}
