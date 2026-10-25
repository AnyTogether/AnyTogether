"use client";

import type { UiStrings } from "@/lib/i18n";
import { type NoticeKind, type NoticeSettings, type NoticeSetup, noticeKinds } from "@/lib/notify";
import { social } from "@/lib/social";
import { type ReactNode, useEffect, useState } from "react";

/** One switch per kind of notification and the mail digest, each saved as soon as it moves. */
export function NotificationSettings({
  setup,
  texts,
  children,
}: {
  setup: NoticeSetup;
  texts: UiStrings;
  /** This device's push switch, between the kinds and the digest. */
  children?: ReactNode;
}) {
  const [settings, setSettings] = useState(setup.settings);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => setStatus("idle"), 2200);
    return () => clearTimeout(timer);
  }, [status]);

  async function change(key: keyof NoticeSettings, value: boolean) {
    const before = settings;
    setSettings({ ...settings, [key]: value });
    const saved = await social<NoticeSetup>("me/notifications/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (!saved.body) {
      setSettings(before);
      return setStatus("error");
    }
    setSettings(saved.body.settings);
    setStatus("saved");
  }

  // An older server leaves the family kinds out: no switch for what it does not send.
  const row = (key: NoticeKind) =>
    settings[key] === undefined ? null : (
      <label key={key} className="toggle-row">
        <span>{texts[`nk_${key}`]}</span>
        <input
          type="checkbox"
          checked={settings[key]}
          onChange={(event) => change(key, event.target.checked)}
        />
        <span className="toggle" />
      </label>
    );

  return (
    <div className="notify-settings">
      <div className="toggles">{noticeKinds.map(row)}</div>
      {children}
      <div className="toggles">
        <label className="toggle-row digest">
          <span className="lines">
            <span>{texts.digest}</span>
            <span className="meta">{setup.canMail ? texts.digestHint : texts.digestNoEmail}</span>
          </span>
          <input
            type="checkbox"
            checked={settings.digest && setup.canMail}
            disabled={!setup.canMail}
            onChange={(event) => change("digest", event.target.checked)}
          />
          <span className="toggle" />
        </label>
        {settings.familyMail !== undefined && (
          <label className="toggle-row digest">
            <span className="lines">
              <span>{texts.familyMail}</span>
              <span className="meta">{setup.canMail ? texts.familyMailHint : texts.digestNoEmail}</span>
            </span>
            <input
              type="checkbox"
              checked={settings.familyMail && setup.canMail}
              disabled={!setup.canMail}
              onChange={(event) => change("familyMail", event.target.checked)}
            />
            <span className="toggle" />
          </label>
        )}
      </div>
      <div className="save-row">
        {status === "error" ? (
          <p className="error" role="alert">
            {texts.failed}
          </p>
        ) : (
          <output className={`saved${status === "saved" ? " on" : ""}`}>
            {status === "saved" ? texts.saved : ""}
          </output>
        )}
      </div>
    </div>
  );
}
