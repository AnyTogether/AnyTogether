"use client";

import { MediaTile, MediaViewer } from "@/components/Media";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import {
  type MediaItem,
  type SaveSlot,
  type StorageOverview,
  type StorageUsage,
  formatBytes,
  savesByGame,
  usageParts,
} from "@/lib/storage";
import { type CSSProperties, useId, useRef, useState } from "react";

const when = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

async function call<T>(path: string, method: string, body?: unknown) {
  const response = await fetch(`/me/storage/${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }).catch(() => undefined);
  const parsed = (await response?.json().catch(() => null)) as T | null;
  return { ok: Boolean(response?.ok), body: parsed };
}

/** How full the quota is: one bar, saves and media in their colours, and the numbers. */
export function UsageBar({ usage, texts }: { usage: StorageUsage; texts: UiStrings }) {
  const parts = usageParts(usage);
  const size = (bytes: number) => formatBytes(bytes, texts.language);
  const percent = usage.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  return (
    <div className={`usage ${parts.level}`}>
      <div className="usage-head">
        <span className="usage-used">{size(usage.used)}</span>
        <span className="usage-of">/ {size(usage.limit)}</span>
        <span className="usage-pct">{percent}%</span>
      </div>
      <div
        className="usage-bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={usage.used}
        aria-valuetext={fill(texts.usedOf, { used: size(usage.used), limit: size(usage.limit) })}
      >
        <i className="saves" style={{ "--w": `${parts.saves}%` } as CSSProperties} />
        <i className="media" style={{ "--w": `${parts.media}%` } as CSSProperties} />
      </div>
      <ul className="usage-legend">
        <li>
          <i className="saves" />
          {texts.legendSaves} <b>{size(usage.saves)}</b>
        </li>
        <li>
          <i className="media" />
          {texts.legendMedia} <b>{size(usage.media)}</b>
        </li>
        <li>
          <i />
          {texts.legendFree} <b>{size(Math.max(0, usage.limit - usage.used))}</b>
        </li>
      </ul>
      {parts.level !== "ok" && (
        <p className={`usage-note${parts.level === "full" ? " full" : ""}`}>
          {parts.level === "full" ? texts.storageFull : texts.storageHigh}
        </p>
      )}
    </div>
  );
}

type Ask = { question: string; action: string; run: () => Promise<void> };

/** Settings → Storage: the usage, every cloud save with its versions (download, make latest,
 *  delete), and the photos, clips and voice notes kept (open, delete). */
export function StorageSettings({ initial, texts }: { initial: StorageOverview; texts: UiStrings }) {
  const [usage, setUsage] = useState(initial.usage);
  const [slots, setSlots] = useState(initial.saves);
  const [media, setMedia] = useState(initial.media);
  const [next, setNext] = useState(initial.next);
  const [open, setOpen] = useState<string | null>(initial.saves[0]?.id ?? null);
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const locale = texts.language;
  const size = (bytes: number) => formatBytes(bytes, locale);

  const confirm = (next: Ask) => {
    setAsk(next);
    sheet.current?.showModal();
  };
  const done = (result: { ok: boolean; body: { usage?: StorageUsage } | null }) => {
    if (!result.ok) {
      setError(texts.failed);
      return false;
    }
    if (result.body?.usage) setUsage(result.body.usage);
    setError(null);
    return true;
  };

  const removeVersion = (slot: SaveSlot, versionId: string) => async () => {
    const result = await call<{ usage: StorageUsage }>(`me/saves/versions/${versionId}`, "DELETE");
    if (!done(result)) return;
    setSlots((all) =>
      all
        .map((s) => (s.id === slot.id ? { ...s, versions: s.versions.filter((v) => v.id !== versionId) } : s))
        .filter((s) => s.versions.length > 0),
    );
  };
  const removeSlot = (slot: SaveSlot) => async () => {
    const result = await call<{ usage: StorageUsage }>(`me/saves/slots/${slot.id}`, "DELETE");
    if (done(result)) setSlots((all) => all.filter((s) => s.id !== slot.id));
  };
  const restore = async (versionId: string) => {
    setBusy(true);
    const result = await call<{ save: SaveSlot; usage: StorageUsage }>(
      `me/saves/versions/${versionId}/restore`,
      "POST",
    );
    setBusy(false);
    if (done(result) && result.body?.save) {
      const fresh = result.body.save;
      setSlots((all) => [fresh, ...all.filter((s) => s.id !== fresh.id)]);
    }
  };
  const removeMedia = (item: MediaItem) => async () => {
    const result = await call<{ usage: StorageUsage }>(`me/media/${item.id}`, "DELETE");
    if (done(result)) setMedia((all) => all.filter((m) => m.id !== item.id));
  };
  const more = async () => {
    if (!next) return;
    const result = await call<{ media: MediaItem[]; next: string | null }>(`me/media?before=${next}`, "GET");
    if (result.ok && result.body) {
      setMedia((all) => [...all, ...(result.body?.media ?? [])]);
      setNext(result.body.next);
    }
  };

  return (
    <div className="storage">
      <UsageBar usage={usage} texts={texts} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <h4 className="storage-sub">
        {texts.savesTitle} <span className="n">{slots.length}</span>
      </h4>
      {slots.length === 0 ? (
        <p className="empty storage-empty">{texts.noSaves}</p>
      ) : (
        <ul className="save-games">
          {savesByGame(slots).map((game) => (
            <li key={game.titleId} className="save-game">
              <div className="save-game-head">
                <span className="game-name">{game.game ?? game.titleId}</span>
                <span className="meta-mono">{game.titleId}</span>
                <span className="meta-mono size">{size(game.size)}</span>
              </div>
              <ul className="save-slots">
                {game.slots.map((slot) => {
                  const latest = slot.versions[0];
                  const expanded = open === slot.id;
                  return (
                    <li key={slot.id} className={`save-slot${expanded ? " open" : ""}`}>
                      <button
                        type="button"
                        className="slot-row"
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : slot.id)}
                      >
                        <span className="slot-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" className="stroke" aria-hidden="true">
                            <path d="M5 4.5h11l3 3v12a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-14.5a.5.5 0 0 1 .5-.5zM8 4.5v5h7v-5M8 20v-6h8v6" />
                          </svg>
                        </span>
                        <span className="lines">
                          <span className="name">{slot.slot}</span>
                          <span className="meta">
                            {slot.versions.length === 1
                              ? texts.versionOne
                              : fill(texts.versionsCount, { n: slot.versions.length })}
                            {latest ? ` · ${when(latest.createdAt, locale)}` : ""}
                            {latest?.device ? ` · ${fill(texts.fromDevice, { device: latest.device })}` : ""}
                          </span>
                        </span>
                        <span className="meta-mono size">{latest ? size(latest.size) : ""}</span>
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke chevron">
                          <path d="M8 10l4 4 4-4" />
                        </svg>
                      </button>
                      {expanded && (
                        <div className="slot-versions">
                          <ol>
                            {slot.versions.map((version, index) => (
                              <li key={version.id}>
                                <span className="lines">
                                  <span className="name">
                                    {fill(texts.versionN, { n: version.version })}
                                    {index === 0 && <span className="tag latest">{texts.latest}</span>}
                                  </span>
                                  <span className="meta">
                                    {when(version.createdAt, locale)}
                                    {version.device ? ` · ${version.device}` : ""}
                                    {version.launcherVersion ? ` · v${version.launcherVersion}` : ""} ·{" "}
                                    {size(version.size)}
                                  </span>
                                </span>
                                <span className="row">
                                  <a className="pill" href={version.download} download>
                                    {texts.downloadSave}
                                  </a>
                                  {index > 0 && (
                                    <button
                                      type="button"
                                      className="pill"
                                      disabled={busy}
                                      onClick={() => restore(version.id)}
                                    >
                                      {texts.restoreVersion}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="pill danger"
                                    onClick={() =>
                                      confirm({
                                        question: fill(texts.confirmDeleteVersion, { n: version.version }),
                                        action: texts.deleteVersion,
                                        run: removeVersion(slot, version.id),
                                      })
                                    }
                                  >
                                    {texts.deleteVersion}
                                  </button>
                                </span>
                              </li>
                            ))}
                          </ol>
                          <button
                            type="button"
                            className="link danger-link"
                            onClick={() =>
                              confirm({
                                question: fill(texts.confirmDeleteSlot, { slot: slot.slot }),
                                action: texts.deleteSlot,
                                run: removeSlot(slot),
                              })
                            }
                          >
                            {texts.deleteSlot}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <h4 className="storage-sub">
        {texts.mediaTitle} <span className="n">{media.length}</span>
      </h4>
      {media.length === 0 ? (
        <p className="empty storage-empty">{texts.noMedia}</p>
      ) : (
        <ul className="media-grid">
          {media.map((item) => (
            <li key={item.id} className={item.hidden ? "hidden-by-mod" : undefined}>
              <button
                type="button"
                className="media-cell"
                aria-label={texts[`kind_${item.kind}`]}
                onClick={() => setViewing(item)}
              >
                <MediaTile item={item} texts={texts} />
              </button>
              <span className="cell-foot">
                <span className="meta-mono">{size(item.size)}</span>
                {typeof item.gallery === "number" && <span className="tag">{texts.inGallery}</span>}
                {item.hidden && <span className="tag warn">{texts.hiddenByModerator}</span>}
                <button
                  type="button"
                  className="pill icon cell-delete"
                  aria-label={texts.deleteMedia}
                  onClick={() =>
                    confirm({
                      question: texts.confirmDeleteMedia,
                      action: texts.deleteMedia,
                      run: removeMedia(item),
                    })
                  }
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
                    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                  </svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button type="button" className="pill more" onClick={more}>
          {texts.showMore}
        </button>
      )}

      <MediaViewer
        item={viewing}
        texts={texts}
        locale={locale}
        canReport={false}
        onClose={() => setViewing(null)}
      />
      <dialog
        ref={sheet}
        className="sheet"
        aria-labelledby={heading}
        onKeyDown={(event) => {
          if (event.key === "Escape") sheet.current?.close();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) sheet.current?.close();
        }}
      >
        <div className="sheet-body">
          <h3 id={heading}>{ask?.action}</h3>
          <p className="hint">{ask?.question}</p>
          <div className="row">
            <button type="button" className="pill" onClick={() => sheet.current?.close()}>
              {texts.cancel}
            </button>
            <button
              type="button"
              className="pill danger solid"
              onClick={async () => {
                sheet.current?.close();
                await ask?.run();
              }}
            >
              {ask?.action}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
