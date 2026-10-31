"use client";

import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";

export type NavGroup = { label: string; items: { id: string; label: string }[] };
export type NavLink = { href: string; label: string };

/** The settings' table of contents. On a wide screen a list beside the page that marks where you
 *  are; on a phone one bar that names the section you are in and opens the list. Picking a section
 *  glides to it (or goes at once with reduced motion) and keeps the address in step. */
export function SettingsNav({
  groups,
  links,
  label,
  sectionsLabel,
}: {
  groups: NavGroup[];
  links: NavLink[];
  /** The nav's name for screen readers. */
  label: string;
  /** The phone bar's small caption, such as "Section". */
  sectionsLabel: string;
}) {
  const ids = groups.flatMap((group) => group.items.map((item) => item.id));
  const [active, setActive] = useState(ids[0] ?? "");
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const idList = ids.join(" ");

  // The section whose top has passed a line a little below the top of the window.
  useEffect(() => {
    const list = idList.split(" ");
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = Math.min(160, window.innerHeight * 0.3);
      let current = list[0] ?? "";
      for (const id of list) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= line) current = id;
      }
      // At the very bottom the last short sections can never reach the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4)
        current = list.filter((id) => document.getElementById(id)).at(-1) ?? current;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [idList]);

  // The phone list closes on Escape and on a tap outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (bar.current && !bar.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const go = useCallback((event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
    // The keyboard follows: the section's title takes focus without a second jump.
    const heading = target.querySelector<HTMLElement>("h3");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    setActive(id);
    setOpen(false);
  }, []);

  const current = groups.flatMap((group) => group.items).find((item) => item.id === active);

  const list = (where: "side" | "sheet") => (
    <>
      {groups.map((group, index) => (
        <div key={group.label} className="snav-group">
          <span className="snav-label" id={`snav-${where}-${index}`}>
            {group.label}
          </span>
          <ul aria-labelledby={`snav-${where}-${index}`}>
            {group.items.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={item.id === active ? "location" : undefined}
                  onClick={(event) => go(event, item.id)}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {links.length > 0 && (
        <ul className="snav-links">
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>
                {link.label}
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 3.5 10.5 8 6 12.5" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <>
      <nav className="snav-side" aria-label={label}>
        {list("side")}
      </nav>
      <div className={`snav-bar${open ? " open" : ""}`} ref={bar}>
        <button
          type="button"
          className="snav-toggle"
          aria-expanded={open}
          aria-controls="snav-sheet"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="snav-caption">{sectionsLabel}</span>
          <span className="snav-current">{current?.label ?? ""}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6.5 8 10.5 12 6.5" />
          </svg>
        </button>
        <nav id="snav-sheet" className="snav-sheet" aria-label={label} hidden={!open}>
          {list("sheet")}
        </nav>
      </div>
    </>
  );
}
