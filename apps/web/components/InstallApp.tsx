"use client";

import type { UiStrings } from "@/lib/i18n";
import { useEffect, useState } from "react";

/** What Chromium browsers hand a page that could be installed (not in TypeScript's DOM types). */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /** Kept by installCatcher, which runs before React does and so never misses the event. */
    __anytogetherInstall?: InstallPrompt | null;
  }
}

/** The event the catcher fires whenever installing becomes possible or is done. */
const changed = "anytogether:install";

/** An inline script for the signed-in pages: keeps the browser's install offer for Settings
 *  instead of letting the browser show its own bar, and notes when the app was installed. */
export const installCatcher = `addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__anytogetherInstall=e;dispatchEvent(new Event("${changed}"))});addEventListener("appinstalled",function(){window.__anytogetherInstall=null;dispatchEvent(new Event("${changed}"))});`;

/** On every signed-in page: the service worker (notifications and the offline page), registered
 *  once the page has loaded, under the same address the notification switch uses. */
export function AppWorker({ language }: { language: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register(`/sw.js?lang=${language}`, { scope: "/" }).catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, [language]);
  return null;
}

type Mode = "hidden" | "prompt" | "ios" | "done";

const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  // iPadOS says it is a Mac.
  (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="inline-share">
    <path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);

/** In Settings: install AnyTogether as an app where the browser offers it (Chrome, Edge, Samsung
 *  Internet…), or how to add it to the Home Screen on an iPhone or iPad. Nothing at all when it
 *  is already installed or the browser has no way to. */
export function InstallApp({ texts }: { texts: UiStrings }) {
  const [mode, setMode] = useState<Mode>("hidden");

  useEffect(() => {
    if (standalone()) return;
    const update = () =>
      setMode((now) =>
        now === "done" ? now : window.__anytogetherInstall ? "prompt" : isIos() ? "ios" : "hidden",
      );
    update();
    window.addEventListener(changed, update);
    return () => window.removeEventListener(changed, update);
  }, []);

  async function install() {
    const offer = window.__anytogetherInstall;
    if (!offer) return;
    await offer.prompt();
    const { outcome } = await offer.userChoice;
    // An offer can be used once; the browser makes a new one if it is still possible.
    window.__anytogetherInstall = null;
    setMode(outcome === "accepted" ? "done" : "hidden");
  }

  if (mode === "hidden") return null;
  const [before, after] = texts.installIos.split("{share}");
  return (
    <article className="card" id="app">
      <h3 className="sub">{texts.sectionApp}</h3>
      <p className="hint section-lead">{texts.appLead}</p>
      <div className={`push-box install-box${mode === "done" ? " on" : ""}`}>
        <span className="device-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
            <path d="M12 7.5v6M9.4 11l2.6 2.6 2.6-2.6M10.5 18.5h3" />
          </svg>
        </span>
        <span className="lines">
          <b>{texts.installHeading}</b>
          <span className="meta" aria-live="polite">
            {mode === "done" ? (
              texts.installDone
            ) : mode === "ios" ? (
              <>
                {before}
                <ShareIcon />
                {after} {texts.installIosNote}
              </>
            ) : (
              texts.installReady
            )}
          </span>
        </span>
        {mode === "prompt" && (
          <button type="button" className="primary small" onClick={install}>
            {texts.installButton}
          </button>
        )}
      </div>
    </article>
  );
}
