import { type CompatPlatform, type CompatSummary, platformNames } from "@/lib/compat";
import { ago } from "@/lib/games";
import type { Strings } from "@/lib/i18n";
import { fill } from "@/lib/people";

/** One platform's verdict: a colored dot, the status, and the version it was last tested on. */
export function CompatVerdict({
  platform,
  summary,
  texts,
  wide,
}: {
  platform: CompatPlatform;
  summary: CompatSummary | undefined;
  texts: Strings;
  /** On a game's page: when it was tested and by how many. */
  wide?: boolean;
}) {
  return (
    <div
      className={`verdict${summary ? ` is-${summary.status}` : " is-untested"}${wide ? " wide-verdict" : ""}`}
    >
      <span className="verdict-platform">{platformNames[platform]}</span>
      <span className="verdict-status">
        <span className={`compat-dot is-${summary?.status ?? "untested"}`} aria-hidden="true" />
        {summary ? texts[`status_${summary.status}`] : texts.notTested}
      </span>
      {summary && (
        <span className="meta verdict-version">
          {wide
            ? `${fill(texts.testedWith, { version: summary.version, when: ago(summary.testedAt, texts.language) })} · ${fill(texts.reportsCount, { n: summary.reports })}`
            : summary.version}
        </span>
      )}
    </div>
  );
}
