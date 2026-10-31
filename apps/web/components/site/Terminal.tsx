import type { CSSProperties } from "react";

const guideUrl = "https://github.com/AnyTogether/AnyTogether/blob/main/docs/self-hosting.md";

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const commands = [
  "git clone https://github.com/AnyTogether/AnyTogether.git",
  "cd AnyTogether/deploy && cp .env.example .env",
  "docker compose up -d --build",
];

/** Running your own AnyTogether in three commands, and one link to the whole guide. The lines wrap
 *  instead of scrolling, so there is never a scrollbar in the box. */
export function SelfHostTerminal({ guide }: { guide: string }) {
  return (
    <div className="terminal" data-reveal>
      <pre>
        <code>
          {commands.map((command, i) => (
            <span key={command} className="ln" style={{ "--i": i } as CSSProperties}>
              <span className="p">$</span> {command}
              {"\n"}
            </span>
          ))}
          <span className="ln" style={{ "--i": commands.length } as CSSProperties}>
            <span className="ok">✓</span> caddy web api realtime postgres valkey
            <i className="caret" />
          </span>
        </code>
      </pre>
      <a href={guideUrl} className="text-link">
        {guide}
        <Arrow />
      </a>
    </div>
  );
}
