"use client";

import type { Look, Ribbons } from "@/lib/ribbons";
import { type CSSProperties, useEffect, useRef } from "react";

/** Asks every backdrop on the page to take another look (the front page's background switch). */
export const lookEvent = "anytogether:look";

type Glyph = {
  shape: "triangle" | "circle" | "cross" | "square";
  x: number;
  y: number;
  size: number;
  depth: number;
};

/** The DualSense's face buttons, drawn as outlines in the seat colours. */
export function GlyphShape({ shape }: { shape: Glyph["shape"] }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      {shape === "triangle" && <path d="M24 9 40 37H8Z" />}
      {shape === "circle" && <circle cx="24" cy="24" r="15" />}
      {shape === "cross" && <path d="M12 12 36 36M36 12 12 36" />}
      {shape === "square" && <rect x="10" y="10" width="28" height="28" rx="1.5" />}
    </svg>
  );
}

const heroGlyphs: Glyph[] = [
  { shape: "triangle", x: 86, y: 13, size: 74, depth: 1 },
  { shape: "circle", x: 95, y: 41, size: 46, depth: 0.55 },
  { shape: "cross", x: 4, y: 49, size: 40, depth: 0.4 },
  { shape: "square", x: 68, y: 14, size: 50, depth: 0.8 },
];
const sideGlyphs: Glyph[] = [
  { shape: "circle", x: 93, y: 24, size: 44, depth: 0.6 },
  { shape: "square", x: 4, y: 70, size: 36, depth: 0.4 },
];

/** A moving background in the launcher's style: its WebGL ribbons once the page has settled, a CSS
 *  gradient of the same colours until then (and wherever WebGL or motion is off), and, if asked,
 *  the PlayStation shapes drifting in front with a little parallax. Purely decorative. */
export function Backdrop({
  look,
  glyphs,
  gain = 1,
  base = 0.5,
  className = "",
}: {
  look: Look;
  glyphs?: "hero" | "side";
  gain?: number;
  base?: number;
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
    window.addEventListener(lookEvent, onLook);
    return () => {
      gone = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener(lookEvent, onLook);
      ribbons?.destroy();
    };
  }, [look, gain, base]);

  const shapes = glyphs === "hero" ? heroGlyphs : glyphs === "side" ? sideGlyphs : [];
  return (
    <div ref={host} className={`backdrop ${className}`} data-look={look} aria-hidden="true">
      <canvas ref={canvas} />
      {shapes.length > 0 && (
        <div className="glyphs">
          {shapes.map((g, i) => (
            <span
              key={g.shape}
              className={`glyph ${g.shape}`}
              style={
                {
                  "--x": `${g.x}%`,
                  "--y": `${g.y}%`,
                  "--s": `${g.size}px`,
                  "--z": g.depth,
                  "--i": i,
                } as CSSProperties
              }
            >
              <i>
                <GlyphShape shape={g.shape} />
              </i>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
