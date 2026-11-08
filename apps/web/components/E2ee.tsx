"use client";

import { useLiveEvents } from "@/components/Live";
import { AttachmentView } from "@/components/Media";
import {
  type ListedDevice,
  type Opened,
  type PersonDevices,
  type SealedAttachment,
  browserDevice,
  browserName,
  checked,
  deviceLine,
  openOne,
  registration,
} from "@/lib/e2ee";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { type Message, json, social } from "@/lib/social";
import { type Attachment, type MediaItem, isShown } from "@/lib/storage";
import { type DeviceSecrets, openFile, safetyGroups } from "@anytogether/e2ee";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/** The server does end-to-end encryption (it has the routes), does not, or is still being asked. */
export type ServerSupport = "unknown" | "yes" | "no";

/** This browser's keys for the signed-in person, registered with the server, and the devices of
 *  the people it seals for, fetched again whenever someone's devices change. */
export function useE2ee(me: string) {
  const [device, setDevice] = useState<DeviceSecrets | null>(null);
  const [server, setServer] = useState<ServerSupport>("unknown");
  const [noStorage, setNoStorage] = useState(false);
  const [people, setPeople] = useState<Record<string, PersonDevices>>({});
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const opened = useRef(new Map<string, Opened>());

  /** The devices of these people, fetched (again, when `force`) and checked. */
  const devicesOf = useCallback(async (ids: string[], force = false) => {
    const wanted = [...new Set(ids)].filter((id) => force || !peopleRef.current[id]);
    if (wanted.length) {
      const { ok, body } = await social<{
        users: { userId: string; devices: ListedDevice[]; removed: ListedDevice[] }[];
      }>(`e2ee/devices?users=${wanted.join(",")}`);
      if (ok && body) {
        const found = Object.fromEntries(body.users.map((u) => [u.userId, checked(u.userId, u)]));
        // Someone left out (no longer a friend or partner) has no devices to seal for.
        for (const id of wanted) found[id] ??= { active: [], removed: [] };
        peopleRef.current = { ...peopleRef.current, ...found };
        setPeople(peopleRef.current);
      }
    }
    return peopleRef.current;
  }, []);

  useEffect(() => {
    if (!me) return;
    let gone = false;
    (async () => {
      // A server without the routes keeps everything as before.
      const asked = await social(`e2ee/devices?users=${me}`);
      if (gone) return;
      if (!asked.ok) return setServer(asked.status === 404 ? "no" : "unknown");
      const mine = await browserDevice(me);
      if (gone) return;
      if (!mine) {
        setNoStorage(true);
        return setServer("yes");
      }
      const here = await social<{ id: string }>("me/e2ee/device");
      if (!here.ok || here.body?.id !== mine.deviceId) {
        const name = browserName(navigator.userAgent);
        const made = await social("me/e2ee/device", { method: "PUT", ...json(registration(mine, me, name)) });
        if (!made.ok) return setServer(made.status === 404 ? "no" : "unknown");
      }
      if (gone) return;
      setDevice(mine);
      setServer("yes");
      await devicesOf([me], true);
    })();
    return () => {
      gone = true;
    };
  }, [me, devicesOf]);

  useLiveEvents((event) => {
    if (event.type === "e2ee.devices" && event.data?.userId) devicesOf([event.data.userId as string], true);
  });

  /** What a message says here, worked out once per version of it. */
  const openMessage = useCallback(
    (message: Message): Opened => {
      if (!message.sealed || message.deletedAt) return { state: "plain" };
      const author = message.authorId ? people[message.authorId] : undefined;
      const key = `${message.id}|${message.sealed.sig}|${author ? author.active.length + author.removed.length : "?"}|${device?.deviceId ?? ""}`;
      const known = opened.current.get(key);
      if (known) return known;
      const result = openOne(message, device, author);
      // Not cached while the author's devices are still coming: it may open in a moment.
      if (author || result.state === "before") opened.current.set(key, result);
      return result;
    },
    [people, device],
  );

  return { device, server, noStorage, people, devicesOf, openMessage };
}

export type E2ee = ReturnType<typeof useE2ee>;

function Lock({ open = false }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d={open ? "M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2" : "M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"} />
    </svg>
  );
}

/** The lock in the thread's head: it opens the sheet with the safety number and the devices. */
export function LockButton({
  texts,
  sealed,
  onOpen,
}: {
  texts: UiStrings;
  sealed: boolean;
  onOpen: () => void;
}) {
  const label = sealed ? texts.e2eeOn : texts.e2eeOff;
  return (
    <button
      type="button"
      className={`pill icon e2ee-lock${sealed ? " on" : ""}`}
      aria-label={label}
      title={label}
      onClick={onOpen}
    >
      <Lock open={!sealed} />
    </button>
  );
}

/** What end-to-end encryption means here, the safety number both people compare, and their
 *  devices. */
export function EncryptionSheet({
  dialog,
  texts,
  name,
  sealed,
  safety,
  compared,
  mine,
  theirs,
  onCompared,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  texts: UiStrings;
  name: string;
  sealed: boolean;
  safety: string | null;
  compared: boolean;
  mine: ListedDevice[];
  theirs: ListedDevice[];
  onCompared: (compared: boolean) => void;
}) {
  const close = () => dialog.current?.close();
  return (
    <dialog
      ref={dialog}
      className="sheet e2ee-sheet"
      aria-labelledby="e2ee-sheet-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <div className="sheet-body">
        <div className={`e2ee-seal${sealed ? " on" : ""}`} aria-hidden="true">
          <Lock open={!sealed} />
        </div>
        <h3 id="e2ee-sheet-title">{sealed ? texts.e2eeOn : texts.e2eeOff}</h3>
        <p className="hint">{fill(sealed ? texts.e2eeOnDetail : texts.e2eeOffDetail, { name })}</p>
        {sealed && safety && (
          <section className="e2ee-safety" aria-label={texts.e2eeSafetyNumber}>
            <h4>{texts.e2eeSafetyNumber}</h4>
            <ol className="e2ee-digits">
              {safetyGroups(safety).map((group, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: twelve fixed places
                <li key={index}>{group}</li>
              ))}
            </ol>
            <p className="hint">{fill(texts.e2eeSafetyHow, { name })}</p>
            <button
              type="button"
              className={`pill${compared ? " e2ee-compared" : " primary"}`}
              aria-pressed={compared}
              onClick={() => onCompared(!compared)}
            >
              {compared ? (
                <>
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                  {texts.e2eeCompared}
                </>
              ) : (
                texts.e2eeMarkCompared
              )}
            </button>
          </section>
        )}
        {sealed && (
          <section className="e2ee-devices" aria-label={texts.e2eeDevices}>
            <h4>{texts.e2eeDevices}</h4>
            <dl>
              <dt>{texts.e2eeYou}</dt>
              <DeviceLines texts={texts} devices={mine} />
              <dt>{name}</dt>
              <DeviceLines texts={texts} devices={theirs} />
            </dl>
            <p className="hint">{texts.e2eeNewDeviceNote}</p>
          </section>
        )}
        <div className="row">
          <button type="button" className="pill" onClick={close}>
            {texts.e2eeClose}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** One person's devices in the sheet: each as its kind and the day it was added. */
function DeviceLines({ texts, devices }: { texts: UiStrings; devices: ListedDevice[] }) {
  if (!devices.length) return <dd>–</dd>;
  return (
    <dd>
      <ul className="e2ee-device-list">
        {devices.map((device) => {
          const line = deviceLine(texts, texts.language, device);
          return (
            <li key={device.id}>
              <span>{line.kind}</span>
              {line.added && <span className="meta">{line.added}</span>}
            </li>
          );
        })}
      </ul>
    </dd>
  );
}

/** Shown in the thread when someone's devices changed since this browser last looked. */
export function DevicesChanged({
  texts,
  whose,
  name,
  onCompare,
  onDismiss,
}: {
  texts: UiStrings;
  whose: "mine" | "theirs";
  name: string;
  onCompare: () => void;
  onDismiss: () => void;
}) {
  return (
    <output className="e2ee-changed">
      <Lock />
      <p>{whose === "theirs" ? fill(texts.e2eeDevicesChanged, { name }) : texts.e2eeMyDevicesChanged}</p>
      <div className="e2ee-changed-actions">
        <button type="button" className="pill small" onClick={onCompare}>
          {texts.e2eeCompare}
        </button>
        <button type="button" className="pill small ghost" onClick={onDismiss}>
          {texts.e2eeDismiss}
        </button>
      </div>
    </output>
  );
}

/** Opened sealed files by media ID, so a thread drawn again does not fetch them again. */
const openedFiles = new Map<string, Promise<{ url: string; poster: string | null }>>();

async function openSealed(item: MediaItem, info: SealedAttachment) {
  const get = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const file = openFile(await get(item.url), "file", info.key, info.nonce);
  const url = URL.createObjectURL(new Blob([file as BlobPart], { type: info.type }));
  let poster: string | null = null;
  if (item.poster && info.poster) {
    const still = await get(item.poster).catch(() => null);
    if (still)
      try {
        poster = URL.createObjectURL(
          new Blob([openFile(still, "poster", info.poster.key, info.poster.nonce) as BlobPart], {
            type: info.poster.type,
          }),
        );
      } catch {
        poster = null;
      }
  }
  return { url, poster };
}

/** A sealed photo, clip or voice note: fetched, opened here and shown like any other. */
export function SealedAttachmentView({
  attachment,
  info,
  texts,
  mine,
  onOpen,
}: {
  attachment: Attachment;
  info: SealedAttachment;
  texts: UiStrings;
  mine: boolean;
  onOpen: (item: MediaItem) => void;
}) {
  const [item, setItem] = useState<MediaItem | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!isShown(attachment)) return;
    let gone = false;
    let job = openedFiles.get(attachment.id);
    if (!job) {
      job = openSealed(attachment, info);
      openedFiles.set(attachment.id, job);
      job.catch(() => openedFiles.delete(attachment.id));
    }
    job.then(
      (opened) => {
        if (gone) return;
        setItem({
          ...attachment,
          contentType: info.type,
          url: opened.url,
          thumb: null,
          poster: opened.poster,
          width: info.width ?? attachment.width,
          height: info.height ?? attachment.height,
          durationMs: info.durationMs ?? attachment.durationMs,
        });
      },
      () => !gone && setFailed(true),
    );
    return () => {
      gone = true;
    };
  }, [attachment, info]);
  if (!isShown(attachment))
    return <AttachmentView attachment={attachment} texts={texts} mine={mine} onOpen={onOpen} />;
  if (failed) return <p className="e2ee-file-failed">{texts.e2eeUndecryptable}</p>;
  if (!item)
    return (
      <div
        className={`media-frame e2ee-opening ${attachment.kind}`}
        style={{ aspectRatio: info.width && info.height ? `${info.width} / ${info.height}` : undefined }}
        aria-busy="true"
      >
        <Lock />
      </div>
    );
  return <AttachmentView attachment={item} texts={texts} mine={mine} onOpen={onOpen} />;
}
