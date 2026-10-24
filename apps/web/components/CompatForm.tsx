"use client";

import {
  type CompatPlatform,
  type CompatStatus,
  compatPlatforms as compatPlatformList,
  compatStatuses,
  platformNames,
} from "@/lib/compat";
import type { UiStrings } from "@/lib/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** A report on how a game runs. On a game's page the game is known; on the list it is typed in. */
export function CompatForm({
  texts,
  game,
  defaultVersion,
}: {
  texts: UiStrings;
  game?: { titleId: string; name: string | null };
  defaultVersion?: string;
}) {
  const router = useRouter();
  const [titleId, setTitleId] = useState(game?.titleId ?? "");
  const [name, setName] = useState(game?.name ?? "");
  const [platform, setPlatform] = useState<CompatPlatform>("macos");
  const [status, setStatus] = useState<CompatStatus | null>(null);
  const [launcherVersion, setLauncherVersion] = useState(defaultVersion ?? "");
  const [engineVersion, setEngineVersion] = useState("");
  const [machine, setMachine] = useState("");
  const [os, setOs] = useState("");
  const [fps, setFps] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sentFor, setSentFor] = useState<string | null>(null);
  const validId = /^[A-Z]{4}[0-9]{5}$/.test(titleId);

  return (
    <form
      className="form compat-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!status || !validId) return;
        setState("busy");
        setError(null);
        const response = await fetch("/me/compat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            titleId,
            ...(name.trim() ? { name: name.trim() } : {}),
            platform,
            status,
            launcherVersion: launcherVersion.trim(),
            ...(engineVersion.trim() ? { engineVersion: engineVersion.trim() } : {}),
            ...(machine.trim() ? { machine: machine.trim() } : {}),
            ...(os.trim() ? { os: os.trim() } : {}),
            ...(fps.trim() && Number.isFinite(Number(fps)) ? { fpsAvg: Number(fps) } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          }),
        }).catch(() => undefined);
        if (response?.ok) {
          setState("sent");
          setSentFor(titleId);
          setNote("");
          setStatus(null);
          router.refresh();
          return;
        }
        const answer = await response?.json().catch(() => null);
        setState("idle");
        setError(response?.status === 429 ? texts.tooMany : (answer?.title ?? texts.failed));
      }}
    >
      {!game && (
        <div className="compat-pair">
          <div className="field-group">
            <label htmlFor="compat-title">{texts.titleIdLabel}</label>
            <input
              id="compat-title"
              value={titleId}
              required
              maxLength={9}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="PPSA01234"
              className="mono-input"
              onChange={(event) => setTitleId(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
          </div>
          <div className="field-group">
            <label htmlFor="compat-name">{texts.gameName}</label>
            <input
              id="compat-name"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <p className="hint-line">{texts.titleIdHint}</p>
        </div>
      )}

      <fieldset className="field-group">
        <legend>{texts.platform}</legend>
        <div
          className="segmented"
          style={{ "--i": compatPlatformList.indexOf(platform) } as React.CSSProperties}
        >
          <span className="thumb" aria-hidden="true" />
          {compatPlatformList.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="platform"
                value={value}
                checked={platform === value}
                onChange={() => setPlatform(value)}
              />
              {platformNames[value]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend>{texts.howFar}</legend>
        <div className="reasons compat-statuses">
          {compatStatuses.map((value) => (
            <label key={value} className={status === value ? "on" : undefined}>
              <input
                type="radio"
                name="status"
                value={value}
                checked={status === value}
                onChange={() => setStatus(value)}
              />
              <span className={`compat-dot is-${value}`} aria-hidden="true" />
              <span className="lines">
                <span className="name">{texts[`status_${value}`]}</span>
                <span className="meta">{texts[`statusHint_${value}`]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="compat-pair">
        <div className="field-group">
          <label htmlFor="compat-launcher">{texts.launcherVersion}</label>
          <input
            id="compat-launcher"
            value={launcherVersion}
            required
            maxLength={40}
            placeholder="0.2.14"
            className="mono-input"
            onChange={(event) => setLauncherVersion(event.target.value)}
          />
        </div>
        <div className="field-group">
          <label htmlFor="compat-engine">{texts.engineVersion}</label>
          <input
            id="compat-engine"
            value={engineVersion}
            maxLength={40}
            placeholder="0.2.14-arm"
            className="mono-input"
            onChange={(event) => setEngineVersion(event.target.value)}
          />
        </div>
        <div className="field-group">
          <label htmlFor="compat-machine">{texts.machine}</label>
          <input
            id="compat-machine"
            value={machine}
            maxLength={120}
            placeholder={texts.machinePlaceholder}
            onChange={(event) => setMachine(event.target.value)}
          />
        </div>
        <div className="field-group">
          <label htmlFor="compat-os">{texts.os}</label>
          <input
            id="compat-os"
            value={os}
            maxLength={60}
            placeholder={texts.osPlaceholder}
            onChange={(event) => setOs(event.target.value)}
          />
        </div>
        <div className="field-group">
          <label htmlFor="compat-fps">{texts.fpsAverage}</label>
          <input
            id="compat-fps"
            value={fps}
            inputMode="decimal"
            maxLength={6}
            className="mono-input"
            onChange={(event) => setFps(event.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
      </div>
      <textarea
        rows={3}
        maxLength={500}
        value={note}
        placeholder={texts.notePlaceholder}
        aria-label={texts.notePlaceholder}
        onChange={(event) => setNote(event.target.value)}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {state === "sent" && (
        <output className="notice success">
          {texts.compatSent}{" "}
          {!game && sentFor && <Link href={`/compatibility/${sentFor}`}>{texts.openGame}</Link>}
        </output>
      )}
      <div className="save-row">
        <button
          type="submit"
          className="primary"
          disabled={!status || !validId || !launcherVersion.trim() || state === "busy"}
        >
          {texts.sendCompat}
        </button>
      </div>
    </form>
  );
}

/** Taking back one's own report. */
export function CompatDelete({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="pill danger small-pill"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/me/compat/${id}`, { method: "DELETE" }).catch(() => undefined);
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
