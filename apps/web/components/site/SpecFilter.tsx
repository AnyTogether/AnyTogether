"use client";

import type { Language } from "@/lib/i18n";
import type { SpecsStrings } from "@/lib/i18n-specs";
import { type SpecPlatform, searchable, specPlatforms } from "@/lib/spec-platforms";
import { type ReactNode, useEffect, useRef, useState } from "react";

const fill = (template: string, values: Record<string, number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** The search box and platform chips over the full specs sheet. The sheet is rendered whole on
 *  the server (it reads fine without JavaScript); this only hides the rows that do not match,
 *  then the groups and sections left empty, and keeps the choice in the address (?q=, ?on=) so a
 *  filtered sheet can be shared. "/" jumps to the box, Escape clears it. */
export function SpecFilter({
  t,
  platforms,
  icons,
  total,
  language,
}: {
  t: SpecsStrings["filter"];
  platforms: SpecsStrings["platforms"];
  /** Each platform's mark, drawn on the server. */
  icons: Record<SpecPlatform, ReactNode>;
  total: number;
  language: Language;
}) {
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<SpecPlatform | null>(null);
  const [shown, setShown] = useState(total);
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  // The choice a shared link carries.
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    setQuery(params.get("q") ?? "");
    const on = params.get("on");
    if (on && (specPlatforms as string[]).includes(on)) setPlatform(on as SpecPlatform);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const words = searchable(query, language).split(/\s+/).filter(Boolean);
    let count = 0;
    for (const row of document.querySelectorAll<HTMLElement>("[data-spec]")) {
      const on = (row.dataset.p ?? "").split(" ");
      const text = row.dataset.q ?? "";
      const match = (!platform || on.includes(platform)) && words.every((word) => text.includes(word));
      row.hidden = !match;
      if (match) count += 1;
    }
    for (const group of document.querySelectorAll<HTMLElement>("[data-spec-group]"))
      group.hidden = !group.querySelector("[data-spec]:not([hidden])");
    for (const section of document.querySelectorAll<HTMLElement>("[data-spec-section]")) {
      const left = section.querySelectorAll("[data-spec]:not([hidden])").length;
      section.hidden = left === 0;
      const link = document.querySelector<HTMLElement>(`.sp-toc a[href="#${section.id}"]`);
      if (link) link.dataset.empty = left === 0 ? "1" : "0";
    }
    setShown(count);
    const filtering = words.length > 0 || !!platform;
    document.documentElement.toggleAttribute("data-spec-filtering", filtering);

    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    if (platform) url.searchParams.set("on", platform);
    else url.searchParams.delete("on");
    window.history.replaceState(window.history.state, "", url);
  }, [query, platform, language, ready]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        box.current?.focus();
        box.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtering = query.trim() !== "" || platform !== null;
  return (
    <search className="sp-filter" aria-label={t.label}>
      <label className="sp-search">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="ico">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4.4-4.4" />
        </svg>
        <span className="visually-hidden">{t.placeholder}</span>
        <input
          ref={box}
          type="search"
          value={query}
          placeholder={t.placeholder}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="sp-key" aria-hidden="true">
          /
        </span>
      </label>
      {/* biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons, not a form to fill in */}
      <div className="sp-chips" role="group" aria-label={t.platform}>
        <button
          type="button"
          className="sp-chip"
          aria-pressed={platform === null}
          onClick={() => setPlatform(null)}
        >
          {t.all}
        </button>
        {specPlatforms.map((p) => (
          <button
            key={p}
            type="button"
            className="sp-chip"
            aria-pressed={platform === p}
            onClick={() => setPlatform(platform === p ? null : p)}
          >
            {icons[p]}
            {platforms[p]}
          </button>
        ))}
      </div>
      <p className="sp-count" aria-live="polite">
        <span>{fill(t.count, { n: shown, total })}</span>
        {filtering && (
          <button
            type="button"
            className="sp-clear"
            onClick={() => {
              setQuery("");
              setPlatform(null);
            }}
          >
            {t.clear}
          </button>
        )}
      </p>
      {filtering && shown === 0 && <p className="sp-none">{t.none}</p>}
    </search>
  );
}
