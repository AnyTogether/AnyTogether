"use client";

import type { UiStrings } from "@/lib/i18n";
import { useEffect, useState } from "react";

type State = "checking" | "unsupported" | "unavailable" | "denied" | "off" | "on" | "busy";

/** The VAPID key as the bytes PushManager wants. */
function keyBytes(base64url: string) {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

async function save(subscription: PushSubscription, lang: string, method: "POST" | "DELETE") {
  const body = method === "POST" ? { ...subscription.toJSON(), lang } : { endpoint: subscription.endpoint };
  const response = await fetch("/me/push", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
  return response?.ok ?? false;
}

/** Browser notifications on this device. The browser is asked for permission only when the
 *  person presses "Turn on notifications", never on its own. */
export function PushSwitch({ publicKey, texts }: { publicKey: string | null; texts: UiStrings }) {
  const [state, setState] = useState<State>("checking");
  const [failed, setFailed] = useState(false);
  const lang = texts.language;

  useEffect(() => {
    (async () => {
      if (!supported()) return setState("unsupported");
      if (!publicKey) return setState("unavailable");
      if (Notification.permission === "denied") return setState("denied");
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription && Notification.permission === "granted") {
        // This sign-in may be newer than the subscription: tell the API again.
        await save(subscription, lang, "POST");
        return setState("on");
      }
      setState("off");
    })().catch(() => setState("off"));
  }, [publicKey, lang]);

  async function turnOn() {
    if (!publicKey) return;
    setFailed(false);
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const registration = await navigator.serviceWorker.register(`/sw.js?lang=${lang}`, { scope: "/" });
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      if (!(await save(subscription, lang, "POST"))) throw new Error("not saved");
      setState("on");
    } catch {
      setFailed(true);
      setState("off");
    }
  }

  async function turnOff() {
    setState("busy");
    const registration = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await save(subscription, lang, "DELETE");
      await subscription.unsubscribe().catch(() => false);
    }
    setState("off");
  }

  const on = state === "on";
  const line =
    state === "unsupported"
      ? texts.pushUnsupported
      : state === "unavailable"
        ? texts.pushUnavailable
        : state === "denied"
          ? texts.pushDenied
          : on
            ? texts.pushOn
            : state === "busy"
              ? texts.pushAsking
              : texts.pushOff;

  return (
    <div className={`push-box${on ? " on" : ""}`}>
      <span className="device-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9.5a6 6 0 0 1 12 0c0 4.6 1.6 6.3 2.3 7a.6.6 0 0 1-.4 1H4.1a.6.6 0 0 1-.4-1c.7-.7 2.3-2.4 2.3-7z" />
          <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
        </svg>
      </span>
      <span className="lines">
        <b>{texts.pushHeading}</b>
        <span className="meta" aria-live="polite">
          {failed ? texts.failed : line}
        </span>
      </span>
      {(state === "off" || state === "busy") && (
        <button type="button" className="primary small" onClick={turnOn} disabled={state === "busy"}>
          {texts.pushTurnOn}
        </button>
      )}
      {on && (
        <button type="button" className="pill" onClick={turnOff}>
          {texts.pushTurnOff}
        </button>
      )}
    </div>
  );
}
