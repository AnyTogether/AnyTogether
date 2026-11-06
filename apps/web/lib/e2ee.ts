import type { Conversation, Message } from "@/lib/social";
import {
  type DeviceSecrets,
  E2eeError,
  type Payload,
  type PublicDevice,
  type Sealed,
  type SealedAttachment,
  deviceFromSeeds,
  newDevice,
  open,
  publicDevice,
  safetyNumber,
  seal,
  unwrapKey,
  verifyDevice,
} from "@anytogether/e2ee";

/** End-to-end encrypted direct messages in the browser (docs/e2ee.md in the AnyTogether repo):
 *  this browser's keys in IndexedDB, the devices both people have, and what a sealed message says
 *  once opened here. The cryptography is @anytogether/e2ee (noble). */

export type { Sealed, SealedAttachment };

export interface ListedDevice extends PublicDevice {
  name: string;
  createdAt: string;
  removedAt: string | null;
}

/** A person's devices as this browser checked them: the active ones and the removed ones (kept to
 *  verify old messages). A device whose signature does not hold is left out. */
export interface PersonDevices {
  active: ListedDevice[];
  removed: ListedDevice[];
}

/** What a message is once this browser looked at it. */
export type Opened =
  | { state: "plain" }
  | { state: "open"; payload: Payload }
  /** Sealed before this device was added: no key for it here. */
  | { state: "before" }
  | { state: "bad" };

// --- keys in IndexedDB -----------------------------------------------------------------------

const dbName = "anytogether-e2ee";
const storeName = "devices";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function stored(key: string): Promise<{ signSeed: Uint8Array; boxSecret: Uint8Array } | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(key: string, value: { signSeed: Uint8Array; boxSecret: Uint8Array }) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** This browser's keys for one account, made the first time; null where the browser keeps no
 *  storage (a private window that refuses IndexedDB). They never leave the browser. */
export async function browserDevice(userId: string): Promise<DeviceSecrets | null> {
  try {
    const key = `device:${userId}`;
    const found = await stored(key);
    if (found) return deviceFromSeeds(new Uint8Array(found.signSeed), new Uint8Array(found.boxSecret));
    const made = newDevice();
    await store(key, { signSeed: made.signSeed, boxSecret: made.boxSecret });
    // Read back, so two tabs that raced end up with the same keys.
    const kept = await stored(key);
    return kept ? deviceFromSeeds(new Uint8Array(kept.signSeed), new Uint8Array(kept.boxSecret)) : null;
  } catch {
    return null;
  }
}

/** A short name for this browser in the device list: "Firefox on macOS". */
export function browserName(agent: string) {
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  const system = /iPhone|iPad/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
}

/** The body PUT /me/e2ee/device takes for this browser. */
export const registration = (device: DeviceSecrets, userId: string, name: string) => {
  const { signKey, boxKey, sig } = publicDevice(device, userId);
  return { signKey, boxKey, sig, name };
};

/** The listed devices of one person that are really theirs. */
export function checked(
  userId: string,
  listed: { devices: ListedDevice[]; removed: ListedDevice[] },
): PersonDevices {
  return {
    active: listed.devices.filter((d) => verifyDevice(userId, d)),
    removed: listed.removed.filter((d) => verifyDevice(userId, d)),
  };
}

// --- messages --------------------------------------------------------------------------------

/** Seals a message for every active device of both people. */
export function sealFor(
  input: { conversationId: string; messageId: string; me: string },
  device: DeviceSecrets,
  devices: ListedDevice[],
  payload: Payload,
) {
  return seal({
    context: { conversationId: input.conversationId, messageId: input.messageId, senderUserId: input.me },
    sender: device,
    recipients: devices.map((d) => ({ id: d.id, boxKey: d.boxKey })),
    payload,
  }).sealed;
}

/** A message as this browser reads it. */
export function openOne(
  message: Pick<Message, "id" | "conversationId" | "authorId" | "attachments"> & { sealed?: Sealed },
  device: DeviceSecrets | null,
  authorDevices: PersonDevices | undefined,
): Opened {
  const sealed = message.sealed;
  if (!sealed) return { state: "plain" };
  if (!device || !message.authorId) return { state: "bad" };
  if (!sealed.keys?.[device.deviceId]) return { state: "before" };
  try {
    const payload = open(
      sealed,
      { conversationId: message.conversationId, messageId: message.id, authorId: message.authorId },
      device,
      [...(authorDevices?.active ?? []), ...(authorDevices?.removed ?? [])],
    );
    if (payload.attachment && message.attachments?.[0]?.id !== payload.attachment.mediaId)
      return { state: "bad" };
    return { state: "open", payload };
  } catch (error) {
    if (error instanceof E2eeError && error.code === "no_key") return { state: "before" };
    return { state: "bad" };
  }
}

/** The content key a report sends, so the moderators can read exactly this message. */
export function contentKeyOf(message: Message, device: DeviceSecrets) {
  const sealed = message.sealed;
  if (!sealed || !message.authorId) return null;
  try {
    const key = unwrapKey(
      sealed,
      {
        conversationId: message.conversationId,
        messageId: message.id,
        senderUserId: message.authorId,
        senderDeviceId: sealed.device,
      },
      device,
    );
    return btoa(String.fromCharCode(...key));
  } catch {
    return null;
  }
}

/** A sealed message shown as a plain one: its text, caption and kind as it really is; the stand-in
 *  text for one that cannot be opened here. */
export function revealed(message: Message, opened: Opened, texts: { before: string; bad: string }): Message {
  if (opened.state === "plain" || message.deletedAt) return message;
  if (opened.state !== "open")
    return {
      ...message,
      text: opened.state === "before" ? texts.before : texts.bad,
      caption: null,
      kind: "text",
    };
  const { text, attachment } = opened.payload;
  if (!attachment) return { ...message, kind: "text", text: text ?? "", caption: null };
  return { ...message, kind: attachment.kind, caption: text ?? null, text: text ?? null };
}

// --- the conversation's state ----------------------------------------------------------------

/** How a direct conversation is written in here:
 *  sealed: both people have a device, every message is sealed;
 *  plain: the other person has no device and it was never encrypted (an older app);
 *  stuck: it is encrypted but the other person (or this browser) has no device now;
 *  off: the server or this browser cannot do it, and it was never encrypted. */
export type ChatMode = "sealed" | "plain" | "stuck" | "off";

export function chatMode(input: {
  serverSupports: boolean;
  device: DeviceSecrets | null;
  encrypted: boolean;
  theirs: number;
}): ChatMode {
  if (!input.serverSupports || !input.device) return input.encrypted ? "stuck" : "off";
  if (input.theirs > 0) return "sealed";
  return input.encrypted ? "stuck" : "plain";
}

/** The other person of a direct conversation. */
export const otherOf = (conversation: Conversation, me: string) =>
  conversation.kind === "direct" ? conversation.members.find((m) => m.userId !== me) : undefined;

/** The safety number of the two people, from their active devices. */
export const safetyOf = (me: string, mine: ListedDevice[], other: string, theirs: ListedDevice[]) =>
  safetyNumber(
    { userId: me, signKeys: mine.map((d) => d.signKey) },
    { userId: other, signKeys: theirs.map((d) => d.signKey) },
  );

// --- what this browser remembers -------------------------------------------------------------

export interface Seen {
  mine: string[];
  theirs: string[];
}

/** Whether the devices changed since this browser last looked, and whose: "theirs" wins when both
 *  did. The first look only remembers. */
export function deviceChange(before: Seen | null, now: Seen): "mine" | "theirs" | null {
  if (!before) return null;
  const same = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  if (!same(before.theirs, now.theirs)) return "theirs";
  if (!same(before.mine, now.mine)) return "mine";
  return null;
}

const read = <T>(key: string): T | null => {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage shut: it is only forgotten.
  }
};

export const memory = {
  seen: (me: string, conversationId: string) => read<Seen>(`e2ee:seen:${me}:${conversationId}`),
  setSeen: (me: string, conversationId: string, seen: Seen) =>
    write(`e2ee:seen:${me}:${conversationId}`, seen),
  compared: (me: string, conversationId: string) => read<string>(`e2ee:compared:${me}:${conversationId}`),
  setCompared: (me: string, conversationId: string, digits: string | null) =>
    write(`e2ee:compared:${me}:${conversationId}`, digits),
  /** Conversations this browser saw encrypted: never plain again here, whatever the server says. */
  encrypted: (me: string, conversationId: string) =>
    read<boolean>(`e2ee:encrypted:${me}:${conversationId}`) === true,
  setEncrypted: (me: string, conversationId: string) => write(`e2ee:encrypted:${me}:${conversationId}`, true),
};

// --- attachments -----------------------------------------------------------------------------

/** A photo drawn again before it is sealed, so no location or camera data goes along (the server
 *  does this for plain photos, but cannot for sealed ones). WebP where the browser makes it, else
 *  JPEG. */
export async function cleanPicture(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const as = (type: string, quality: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
    const webp = await as("image/webp", 0.88);
    const blob = webp?.type === "image/webp" ? webp : await as("image/jpeg", 0.9);
    if (!blob) throw new Error("the picture could not be drawn");
    return { blob, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
