"use client";

import type { MotionStrings } from "@/lib/i18n-motion";
import type { Look } from "@/lib/ribbons";
import { useState } from "react";
import { lookEvent } from "./Backdrop";

const looks = ["cosmic", "aurora", "sunset"] as const;

/** The launcher's three backgrounds, tried on the front page's own: the ribbons behind the hero
 *  blend over to the one picked, as they do in the launcher's settings. */
export function LookSwitch({ t, className = "" }: { t: MotionStrings["looks"]; className?: string }) {
  const [current, setCurrent] = useState<Look>("cosmic");
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons, not a form to fill in
    <div className={`look-switch ${className}`} role="group" aria-label={t.label}>
      <span className="look-label" aria-hidden="true">
        {t.label}
      </span>
      <div className="look-options" data-current={current}>
        {looks.map((look) => (
          <button
            key={look}
            type="button"
            className={`look ${look}`}
            aria-pressed={current === look}
            onClick={() => {
              setCurrent(look);
              window.dispatchEvent(new CustomEvent(lookEvent, { detail: look }));
            }}
          >
            <i />
            {t[look]}
          </button>
        ))}
      </div>
    </div>
  );
}
