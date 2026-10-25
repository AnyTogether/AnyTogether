"use client";

import type { MotionStrings } from "@/lib/i18n-motion";
import type { SiteStrings } from "@/lib/i18n-site";
import type { ShotName } from "@/lib/shots";
import { useEffect, useRef, useState } from "react";
import { Shot } from "./Shot";

/** Share play told in four steps over real frames from a test with Cat Quest III: the host's game,
 *  the game asking player 2 to join, both cats in the world, and the second cat moving. The seats
 *  and a notice change with each step. Plays only on screen; with reduced motion the steps become
 *  buttons and nothing moves by itself. */

const frames: ShotName[] = ["share-frame", "share-coop", "share-world", "share-p2"];
const stepMs = 3600;

export function LiveShare({ t, s }: { t: MotionStrings["share"]; s: SiteStrings["landing"]["share"] }) {
  const box = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(([entry]) => setRunning(!!entry?.isIntersecting), {
      threshold: 0.35,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the timer starts again at every step
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setStep((n) => (n + 1) % frames.length), stepMs);
    return () => window.clearTimeout(timer);
  }, [running, step]);

  const alts = [s.hostAlt, s.coopAlt, s.worldAlt, s.worldAlt];
  return (
    <div ref={box} className={`ls${running ? " running" : ""}`} data-step={step}>
      <ol className="ls-steps">
        {t.steps.map(([title, detail], i) => (
          <li key={title} className={i === step ? "on" : i < step ? "done" : ""}>
            <button type="button" onClick={() => setStep(i)} aria-pressed={i === step}>
              <span className="ls-num">{i + 1}</span>
              <span className="ls-copy">
                <b>{title}</b>
                <span>{detail}</span>
              </span>
              {i === step && running && <i className="ls-bar" key={`bar${step}`} />}
            </button>
          </li>
        ))}
      </ol>

      <div className="ls-stage">
        <div className="ls-frames">
          {frames.map((name, i) => (
            <figure key={name} className={i === step ? "on" : ""} aria-hidden={i !== step}>
              <Shot name={name} alt={alts[i] ?? ""} sizes="(max-width: 760px) 100vw, 760px" />
            </figure>
          ))}
        </div>
        <div className="ls-live" aria-hidden="true">
          <i />
          {t.live}
          <span>{step >= 3 ? t.watching : step >= 2 ? t.watching.replace("2", "1") : ""}</span>
        </div>
        <div className={`ls-toast${step === 2 ? " on" : ""}`} aria-hidden="true">
          <span className="ls-seat">P2</span>
          <span>
            <b>Mira</b> {t.joined}
          </span>
        </div>
        <ul className="ls-seats" aria-label={s.seats}>
          <li className="seat p1 lit">
            <i />
            <b>P1</b>
            <span>{s.host}</span>
          </li>
          <li className={`seat p2${step >= 2 ? " lit" : step === 1 ? " ask" : ""}`}>
            <i />
            <b>P2</b>
            <span>
              {step >= 2
                ? `Mira · ${s.p2.split(" · ").slice(0, 2).join(" · ")}`
                : step === 1
                  ? "Mira …"
                  : s.p4}
            </span>
          </li>
          <li className={`seat p3${step >= 3 ? " lit" : ""}`}>
            <i />
            <b>P3</b>
            <span>{step >= 3 ? `Sol · ${s.p3.split(" · ")[0]}` : s.p4}</span>
          </li>
          <li className="seat p4">
            <i />
            <b>P4</b>
            <span>{s.p4}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
