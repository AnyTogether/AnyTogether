"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

/** A row of pictures as one endless strip: it starts at the left edge of the text, has no
 *  scrollbar, and is dragged left or right with the mouse or a finger (a trackpad's sideways swipe
 *  and the arrow keys move it too), wrapping around for ever. It only ever moves when it is moved:
 *  nothing slides by itself. A throw keeps it gliding for a moment, except with reduced motion.
 *
 *  Without JavaScript it is a plain sideways-scrolling row (the scrollbar hidden). The copies that
 *  make the loop are hidden from screen readers and from the keyboard. */
export function Strip({ children, label }: { children: ReactNode; label: string }) {
  const strip = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const state = useRef({
    x: 0,
    width: 0,
    start: 0,
    step: 0,
    velocity: 0,
    frame: 0,
    dragging: false,
    pointer: -1,
    lastX: 0,
    lastT: 0,
  });

  const paint = useCallback(() => {
    const s = state.current;
    const el = track.current;
    if (!el || !s.width) return;
    const within = ((s.x % s.width) + s.width) % s.width;
    el.style.transform = `translate3d(${s.start - s.width - within}px, 0, 0)`;
  }, []);

  const measure = useCallback(() => {
    const s = state.current;
    const box = strip.current;
    const first = group.current;
    if (!box || !first) return;
    const anchor = box.parentElement;
    s.width = first.getBoundingClientRect().width;
    s.start = anchor ? anchor.getBoundingClientRect().left - box.getBoundingClientRect().left : 0;
    const item = first.firstElementChild as HTMLElement | null;
    const gap = Number.parseFloat(getComputedStyle(first).columnGap) || 0;
    s.step = item ? item.getBoundingClientRect().width + gap : s.width / 3;
    paint();
  }, [paint]);

  useEffect(() => {
    setLive(true);
  }, []);

  useEffect(() => {
    if (!live) return;
    const box = strip.current;
    if (!box) return;
    const s = state.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(box);
    if (group.current) resized.observe(group.current);

    const stop = () => {
      cancelAnimationFrame(s.frame);
      s.frame = 0;
    };
    const glide = () => {
      s.velocity *= 0.94;
      s.x += s.velocity;
      paint();
      s.frame = Math.abs(s.velocity) > 0.3 ? requestAnimationFrame(glide) : 0;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      stop();
      s.dragging = true;
      s.pointer = e.pointerId;
      s.lastX = e.clientX;
      s.lastT = e.timeStamp;
      s.velocity = 0;
      box.setPointerCapture(e.pointerId);
      box.dataset.dragging = "";
    };
    const move = (e: PointerEvent) => {
      if (!s.dragging || e.pointerId !== s.pointer) return;
      const dx = e.clientX - s.lastX;
      const dt = Math.max(1, e.timeStamp - s.lastT);
      s.x -= dx;
      // Pixels per frame (16 ms), smoothed, for the throw.
      s.velocity = 0.6 * s.velocity + 0.4 * ((-dx / dt) * 16);
      s.lastX = e.clientX;
      s.lastT = e.timeStamp;
      paint();
    };
    const up = (e: PointerEvent) => {
      if (!s.dragging || e.pointerId !== s.pointer) return;
      s.dragging = false;
      delete box.dataset.dragging;
      if (box.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
      // A pause before letting go means no throw.
      if (e.timeStamp - s.lastT > 80) s.velocity = 0;
      if (!still.matches && Math.abs(s.velocity) > 0.3) s.frame = requestAnimationFrame(glide);
    };
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      stop();
      s.x += e.deltaX;
      paint();
    };
    const ease = (to: number) => {
      stop();
      if (still.matches) {
        s.x = to;
        paint();
        return;
      }
      const from = s.x;
      const began = performance.now();
      const run = (now: number) => {
        const t = Math.min(1, (now - began) / 320);
        s.x = from + (to - from) * (1 - (1 - t) ** 3);
        paint();
        s.frame = t < 1 ? requestAnimationFrame(run) : 0;
      };
      s.frame = requestAnimationFrame(run);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const base = Math.round(s.x / s.step) * s.step;
      ease(base + (e.key === "ArrowRight" ? s.step : -s.step));
    };
    const noDrag = (e: DragEvent) => e.preventDefault();

    box.addEventListener("pointerdown", down);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);
    box.addEventListener("wheel", wheel, { passive: false });
    box.addEventListener("keydown", key);
    box.addEventListener("dragstart", noDrag);
    return () => {
      stop();
      resized.disconnect();
      box.removeEventListener("pointerdown", down);
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerup", up);
      box.removeEventListener("pointercancel", up);
      box.removeEventListener("wheel", wheel);
      box.removeEventListener("keydown", key);
      box.removeEventListener("dragstart", noDrag);
    };
  }, [live, measure, paint]);

  const copy = (key: string) => (
    <div key={key} className="strip-group" aria-hidden="true" inert>
      {children}
    </div>
  );

  return (
    <section
      ref={strip}
      className="strip"
      data-live={live ? "" : undefined}
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={live ? 0 : undefined}
    >
      <div ref={track} className="strip-track">
        {live && copy("before")}
        <div ref={group} className="strip-group">
          {children}
        </div>
        {live && copy("after")}
        {live && copy("after-2")}
      </div>
    </section>
  );
}
