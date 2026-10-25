"use client";

import type { Look, Ribbons } from "@/lib/ribbons";
import { useEffect, useRef } from "react";

/** Asks every backdrop on the page to take another look (the front page's background switch). */
export const lookEvent = "anytogether:look";

/** The DualSense's face buttons, drawn as outlines in the seat colours. */
export function GlyphShape({ shape }: { shape: "triangle" | "circle" | "cross" | "square" }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      {shape === "triangle" && <path d="M24 9 40 37H8Z" />}
      {shape === "circle" && <circle cx="24" cy="24" r="15" />}
      {shape === "cross" && <path d="M12 12 36 36M36 12 12 36" />}
      {shape === "square" && <rect x="10" y="10" width="28" height="28" rx="1.5" />}
    </svg>
  );
}

/** A moving background in the launcher's style: its WebGL ribbons once the page has settled, a CSS
 *  gradient of the same colours until then (and wherever WebGL or motion is off). Purely
 *  decorative. */
export function Backdrop({
  look,
  gain = 1,
  base = 0.5,
  switchable = false,
  className = "",
}: {
  look: Look;
  gain?: number;
  base?: number;
  /** Follows the background switch (LookSwitch) on the page. */
  switchable?: boolean;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = host.current;
    const surface = canvas.current;
    if (!element || !surface) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let ribbons: Ribbons | null = null;
    let visible = false;
    let loading = false;
    let gone = false;
    const update = () => ribbons?.play(visible && !document.hidden);
    const load = () => {
      if (loading) return;
      loading = true;
      const go = () =>
        import("@/lib/ribbons").then(({ startRibbons }) => {
          if (gone) return;
          ribbons = startRibbons(surface, {
            look: (element.dataset.look as Look) ?? look,
            gain,
            base,
            still,
            scale: window.innerWidth < 760 ? 0.6 : 0.5,
            onFirstFrame: () => {
              element.dataset.lit = "";
            },
          });
          update();
        });
      // After the page's own work: the ribbons never compete with the first paint.
      if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 1600 });
      else setTimeout(go, 300);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        if (visible) load();
        update();
      },
      { rootMargin: "120px 0px" },
    );
    observer.observe(element);
    const onLook = (event: Event) => {
      const next = (event as CustomEvent<Look>).detail;
      element.dataset.look = next;
      ribbons?.setLook(next);
    };
    document.addEventListener("visibilitychange", update);
    if (switchable) window.addEventListener(lookEvent, onLook);
    return () => {
      gone = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener(lookEvent, onLook);
      ribbons?.destroy();
    };
  }, [look, gain, base, switchable]);

  return (
    <div ref={host} className={`backdrop ${className}`} data-look={look} aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}
