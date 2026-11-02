"use client";

import type { Project } from "@/lib/changelog";
import { type MouseEvent, useEffect, useRef, useState } from "react";

const lead = 3;

/** The project chips over the changelog. The whole list comes with the page, so a chip only hides
 *  the other project's releases: no new page, no wait. The choice stays in the address
 *  (?project=), and each chip is a plain link without JavaScript. */
export function ChangelogFilter({
  initial,
  label,
  all,
  projects,
  counts,
}: {
  initial: Project | null;
  label: string;
  all: string;
  projects: { id: Project; name: string; detail: string }[];
  /** The count line for each choice, already worded. */
  counts: Record<Project | "all", string>;
}) {
  const [only, setOnly] = useState<Project | null>(initial);
  const first = useRef(true);

  useEffect(() => {
    // The server already drew the first choice.
    if (first.current) {
      first.current = false;
      return;
    }
    let shown = 0;
    for (const entry of document.querySelectorAll<HTMLElement>("[data-cl-entry]")) {
      const match = !only || entry.dataset.project === only;
      entry.hidden = !match;
      if (!match) continue;
      const open = shown < lead;
      entry.classList.toggle("folded", !open);
      const notes = entry.querySelector<HTMLDetailsElement>("details[data-cl-notes]");
      if (notes) notes.open = open;
      shown += 1;
    }
    const url = new URL(window.location.href);
    if (only) url.searchParams.set("project", only);
    else url.searchParams.delete("project");
    window.history.replaceState(window.history.state, "", url);
  }, [only]);

  const pick = (event: MouseEvent, project: Project | null) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    setOnly(project);
  };

  return (
    <nav className="cl-filter" aria-label={label}>
      <span className="pg-label">{label}</span>
      <ul>
        <li>
          <a
            href="/changelog"
            className="cl-chip"
            aria-current={only ? undefined : "page"}
            onClick={(e) => pick(e, null)}
          >
            {all}
          </a>
        </li>
        {projects.map((project) => (
          <li key={project.id}>
            <a
              href={`/changelog?project=${project.id}`}
              className="cl-chip"
              aria-current={only === project.id ? "page" : undefined}
              onClick={(e) => pick(e, project.id)}
            >
              {project.name}
              <span className="meta">{project.detail}</span>
            </a>
          </li>
        ))}
      </ul>
      <span className="meta cl-count" aria-live="polite">
        {counts[only ?? "all"]}
      </span>
    </nav>
  );
}

/** A release's notes under a fold. The newest releases' notes come with the page; an older one's
 *  load from /changelog/notes the first time it is opened (until then, and without JavaScript, a
 *  link to them on GitHub). The HTML is the server's, sanitised by notesToHtml. */
export function ReleaseNotes({
  id,
  label,
  html,
  open,
  github,
  githubLabel,
}: {
  id: string;
  label: string;
  html: string | null;
  open: boolean;
  github: string;
  githubLabel: string;
}) {
  const [shown, setShown] = useState(html);
  const asked = useRef(false);
  return (
    <details
      className="cl-more"
      open={open}
      data-cl-notes
      onToggle={(event) => {
        if (!event.currentTarget.open || shown !== null || asked.current) return;
        asked.current = true;
        fetch(`/changelog/notes?id=${encodeURIComponent(id)}`)
          .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
          .then(setShown)
          .catch(() => {
            asked.current = false;
          });
      }}
    >
      <summary>{label}</summary>
      {shown !== null ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised on the server by notesToHtml, raw HTML dropped
        <div className="prose" lang="en" dangerouslySetInnerHTML={{ __html: shown }} />
      ) : (
        <p className="cl-elsewhere">
          <a href={github} className="text-link">
            {githubLabel}
          </a>
        </p>
      )}
    </details>
  );
}
