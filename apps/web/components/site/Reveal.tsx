"use client";

import { useEffect } from "react";

/** Parts marked data-reveal rise in as they scroll into view. Without JavaScript, or with reduced
 *  motion, they are simply there: nothing is hidden until this has run, and what is already on
 *  screen when it runs is never hidden at all. */
export function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver !== "function") return;
    const parts = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
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
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("reveal-ready");
    };
  }, []);
  return null;
}
