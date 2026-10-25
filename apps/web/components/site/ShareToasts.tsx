"use client";

import type { MotionStrings } from "@/lib/i18n-motion";
import { useEffect, useRef, useState } from "react";

/** Notices stacking up over the share play pictures, the way they arrive in the launcher: who
 *  started watching, who took a controller. Decorative (the people are made up), so hidden from
 *  screen readers; it only moves while on screen and holds still with reduced motion. */
export function ShareToasts({ toasts }: { toasts: MotionStrings["toasts"] }) {
  const box = useRef<HTMLDivElement>(null);
  // How many notices have arrived so far; the newest three are drawn, the one before fades away.
  const [count, setCount] = useState(toasts.length);

  useEffect(() => {
    const element = box.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        window.clearInterval(timer);
        if (entry?.isIntersecting) timer = window.setInterval(() => setCount((n) => n + 1), 2600);
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const shown = [];
  for (let n = Math.max(0, count - 4); n < count; n++) shown.push(n);
  return (
    <div ref={box} className="toasts" aria-hidden="true">
      {shown.map((n) => {
        const toast = toasts[n % toasts.length];
        if (!toast) return null;
        const depth = count - 1 - n;
        return (
          <div key={n} className={`toast seat-${toast.seat}`} data-depth={depth}>
            <span className="toast-seat">P{toast.seat}</span>
            <span className="toast-text">
              <b>{toast.who}</b> {toast.what}
            </span>
          </div>
        );
      })}
    </div>
  );
}
