"use client";

import { useEffect } from "react";

/** The public pages' small motions, all switched on by data attributes and all optional:
 *
 *  - data-reveal: rises in as it scrolls into view;
 *  - data-count: a number counts up to its value the first time it is seen;
 *  - data-loop: a looping animation that only runs while on screen (data-inview);
 *  - data-parallax: follows the pointer through --px and --py (−1 to 1), for tilts and depth;
 *  - data-spot: a soft light under the pointer (--mx, --my);
 *  - .toc: the link of the chapter being read is marked as current.
 *
 *  Without JavaScript, or with reduced motion, everything is simply there: nothing is hidden until
 *  this has run, and what is already on screen when it runs is never hidden at all. */
export function Reveal() {
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const cleanups: (() => void)[] = [];
    if (typeof IntersectionObserver !== "function") return;

    // Rise in.
    const parts = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const counters = Array.from(document.querySelectorAll<HTMLElement>("[data-count]"));
    if (!still) {
      const height = window.innerHeight;
      for (const part of parts) {
        const box = part.getBoundingClientRect();
        if (box.top < height && box.bottom > 0) part.dataset.reveal = "shown";
      }
      document.documentElement.classList.add("reveal-ready");
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            (entry.target as HTMLElement).dataset.reveal = "shown";
            observer.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
      );
      for (const part of parts) if (part.dataset.reveal !== "shown") observer.observe(part);
      cleanups.push(() => {
        observer.disconnect();
        document.documentElement.classList.remove("reveal-ready");
      });

      // Count up: the number written by the server stays until the counter is about to be seen.
      const counting = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            counting.unobserve(entry.target);
            countUp(entry.target as HTMLElement);
          }
        },
        { threshold: 0.6 },
      );
      for (const counter of counters) counting.observe(counter);
      cleanups.push(() => counting.disconnect());
    }

    // Loops run only on screen.
    const loops = Array.from(document.querySelectorAll<HTMLElement>("[data-loop]"));
    if (loops.length) {
      const watching = new IntersectionObserver((entries) => {
        for (const entry of entries)
          (entry.target as HTMLElement).dataset.inview = entry.isIntersecting ? "1" : "0";
      });
      for (const loop of loops) {
        loop.dataset.inview = "0";
        watching.observe(loop);
      }
      cleanups.push(() => watching.disconnect());
    }

    // Pointer: parallax and the light under it, for a mouse or a trackpad only.
    if (fine && !still) {
      const stages = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
      const onScreen = new Set<HTMLElement>();
      const seeing = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const stage = entry.target as HTMLElement;
          if (entry.isIntersecting) onScreen.add(stage);
          else onScreen.delete(stage);
        }
      });
      for (const stage of stages) seeing.observe(stage);
      let frame = 0;
      let x = 0;
      let y = 0;
      let target: EventTarget | null = null;
      const apply = () => {
        frame = 0;
        for (const stage of onScreen) {
          const box = stage.getBoundingClientRect();
          const px = Math.max(-1, Math.min(1, ((x - box.left) / box.width) * 2 - 1));
          const py = Math.max(-1, Math.min(1, ((y - box.top) / box.height) * 2 - 1));
          stage.style.setProperty("--px", px.toFixed(3));
          stage.style.setProperty("--py", py.toFixed(3));
        }
        const spot = target instanceof Element ? target.closest<HTMLElement>("[data-spot]") : null;
        if (spot) {
          const box = spot.getBoundingClientRect();
          spot.style.setProperty("--mx", `${Math.round(x - box.left)}px`);
          spot.style.setProperty("--my", `${Math.round(y - box.top)}px`);
        }
      };
      const onMove = (event: PointerEvent) => {
        x = event.clientX;
        y = event.clientY;
        target = event.target;
        if (!frame) frame = requestAnimationFrame(apply);
      };
      const onLeave = () => {
        for (const stage of stages) {
          stage.style.setProperty("--px", "0");
          stage.style.setProperty("--py", "0");
        }
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      cleanups.push(() => {
        seeing.disconnect();
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", onMove);
        document.documentElement.removeEventListener("pointerleave", onLeave);
      });
    }

    // The chapter being read, in the page's table of contents.
    const toc = document.querySelector<HTMLElement>(".toc");
    if (toc) {
      const links = Array.from(toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
      const list = toc.querySelector<HTMLElement>("ul");
      const sections = links
        .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
        .filter((section): section is HTMLElement => !!section);
      const reading = new Set<string>();
      const mark = () => {
        const id = sections.find((section) => reading.has(section.id))?.id;
        for (const link of links) {
          const current = !!id && link.hash === `#${id}`;
          if (current) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
          if (current && list) {
            const left = link.offsetLeft - list.clientWidth / 2 + link.offsetWidth / 2;
            list.scrollTo({ left, behavior: still ? "auto" : "smooth" });
          }
        }
      };
      const spy = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) reading.add(entry.target.id);
            else reading.delete(entry.target.id);
          }
          mark();
        },
        { rootMargin: "-30% 0px -60% 0px" },
      );
      for (const section of sections) spy.observe(section);
      cleanups.push(() => spy.disconnect());
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);
  return null;
}

/** Counts a number up from zero over about a second, easing out, in the page's own number format.
 *  data-count holds the value (or the text's own leading number is used); data-compact asks for
 *  the short form (1.8K). */
function countUp(element: HTMLElement) {
  const text = element.textContent ?? "";
  const match = /^(\d+)(.*)$/.exec(text.trim());
  const value = element.dataset.count ? Number(element.dataset.count) : match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) return;
  const suffix = element.dataset.count ? "" : (match?.[2] ?? "");
  const lang = document.documentElement.lang || "en";
  const format = new Intl.NumberFormat(
    lang,
    element.dataset.compact !== undefined ? { notation: "compact", maximumFractionDigits: 1 } : {},
  );
  const final = text;
  const duration = 1100;
  const start = performance.now();
  // The width is held so the line around the number never shifts while it counts.
  element.style.minWidth = `${element.getBoundingClientRect().width}px`;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 4;
    if (t < 1) {
      element.textContent = `${format.format(Math.round(value * eased))}${suffix}`;
      requestAnimationFrame(step);
    } else {
      element.textContent = final;
      element.style.minWidth = "";
    }
  };
  requestAnimationFrame(step);
}
