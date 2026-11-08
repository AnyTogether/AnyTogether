import {
  type ListedDevice,
  browserName,
  chatMode,
  checked,
  contentKeyOf,
  deviceChange,
  deviceLine,
  openOne,
  revealed,
  safetyOf,
  sealFor,
} from "@/lib/e2ee";
import type { Message } from "@/lib/social";
import { newDevice, publicDevice } from "@anytogether/e2ee";
import { describe, expect, it } from "vitest";
import { chatEn, chatTr } from "../lib/i18n-chat";

const utku = "0190f1a2-0000-7000-8000-00000000a11c";
const ayse = "0190f1a2-0000-7000-8000-000000000b0b";
const conversationId = "0190f1a2-0000-7000-8000-0000000c0c0c";
const listed = (userId: string, device = newDevice(), name = "Mac"): [ListedDevice, typeof device] => [
  { ...publicDevice(device, userId), name, createdAt: "", removedAt: null },
  device,
];
const texts = { before: "Sent before this device was added.", bad: "This message could not be decrypted." };

const message = (sealed: Message["sealed"], id: string, extra: Partial<Message> = {}): Message => ({
  id,
  conversationId,
  seq: 1,
  authorId: utku,
  kind: "text",
  text: "[encrypted message]",
  caption: null,
  attachments: [],
  replyTo: null,
  editedAt: null,
  deletedAt: null,
  createdAt: "",
  sealed,
  ...extra,
});

describe("sealed messages in the browser", () => {
  const [mac, macKeys] = listed(utku);
  const [desktop, desktopKeys] = listed(ayse, newDevice(), "Desktop");
  const id = crypto.randomUUID();
  const sealed = sealFor({ conversationId, messageId: id, me: utku }, macKeys, [mac, desktop], {
    v: 1,
    text: "selam",
  });
  const devices = { active: [mac], removed: [] };

  it("open as the plain message they were", () => {
    const opened = openOne(message(sealed, id), desktopKeys, devices);
    expect(opened).toEqual({ state: "open", payload: { v: 1, text: "selam" } });
    expect(revealed(message(sealed, id), opened, texts)).toMatchObject({ text: "selam", kind: "text" });
  });

  it("say when they came before this device, or could not be opened", () => {
    const later = newDevice();
    expect(revealed(message(sealed, id), openOne(message(sealed, id), later, devices), texts).text).toBe(
      texts.before,
    );
    expect(openOne(message(sealed, id), desktopKeys, { active: [desktop], removed: [] }).state).toBe("bad");
    expect(openOne(message(sealed, crypto.randomUUID()), desktopKeys, devices).state).toBe("bad");
    expect(openOne(message(undefined, id), desktopKeys, devices).state).toBe("plain");
  });

  it("refuse an attachment the server swapped for another", () => {
    const mediaId = crypto.randomUUID();
    const attachment = { mediaId, kind: "image" as const, type: "image/webp", size: 9, key: "a", nonce: "b" };
    const withMedia = sealFor({ conversationId, messageId: id, me: utku }, macKeys, [mac, desktop], {
      v: 1,
      attachment,
    });
    const shown = { id: mediaId, kind: "image" as const, removed: true as const };
    expect(openOne(message(withMedia, id, { attachments: [shown] }), desktopKeys, devices).state).toBe(
      "open",
    );
    const other = { ...shown, id: crypto.randomUUID() };
    expect(openOne(message(withMedia, id, { attachments: [other] }), desktopKeys, devices).state).toBe("bad");
  });

  it("give a report the content key of exactly that message", () => {
    expect(contentKeyOf(message(sealed, id), desktopKeys)).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(contentKeyOf(message(undefined, id), desktopKeys)).toBeNull();
  });

  it("only trust devices whose signature holds for their person", () => {
    const [stranger] = listed(ayse);
    expect(checked(utku, { devices: [mac, stranger], removed: [] }).active).toEqual([mac]);
  });
});

describe("a direct conversation's mode", () => {
  const device = newDevice();
  it("is sealed when both have a device, plain for an older app, and never plain again once encrypted", () => {
    expect(chatMode({ serverSupports: true, device, encrypted: false, theirs: 1 })).toBe("sealed");
    expect(chatMode({ serverSupports: true, device, encrypted: false, theirs: 0 })).toBe("plain");
    expect(chatMode({ serverSupports: true, device, encrypted: true, theirs: 0 })).toBe("stuck");
    expect(chatMode({ serverSupports: false, device, encrypted: false, theirs: 0 })).toBe("off");
    expect(chatMode({ serverSupports: true, device: null, encrypted: true, theirs: 2 })).toBe("stuck");
  });
});

describe("device changes", () => {
  it("are told once something changed, whose first, and not on the first look", () => {
    expect(deviceChange(null, { mine: ["a"], theirs: ["b"] })).toBeNull();
    expect(deviceChange({ mine: ["a"], theirs: ["b"] }, { mine: ["a"], theirs: ["b"] })).toBeNull();
    expect(deviceChange({ mine: ["a"], theirs: ["b"] }, { mine: ["a", "c"], theirs: ["b"] })).toBe("mine");
    expect(deviceChange({ mine: ["a"], theirs: ["b"] }, { mine: ["c"], theirs: [] })).toBe("theirs");
  });

  it("change the safety number", () => {
    const [mac] = listed(utku);
    const [phone] = listed(utku);
    const [desktop] = listed(ayse);
    const before = safetyOf(utku, [mac], ayse, [desktop]);
    expect(before).toMatch(/^\d{60}$/);
    expect(safetyOf(ayse, [desktop], utku, [mac])).toBe(before);
    expect(safetyOf(utku, [mac, phone], ayse, [desktop])).not.toBe(before);
  });
});

describe("browser names", () => {
  it("say the browser and the system", () => {
    expect(
      browserName(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      ),
    ).toBe("Safari on macOS");
    expect(
      browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0"),
    ).toBe("Firefox on Windows");
  });
});

describe("device lists", () => {
  it("show each device as its kind and the day it was added, never the name its app gave", () => {
    const at = "2026-11-03T10:00:00.000Z";
    expect(deviceLine(chatEn, "en", { name: "Utku's MacBook Pro · AnyPS5", createdAt: at })).toEqual({
      kind: "Mac",
      added: "Added November 3, 2026",
    });
    expect(deviceLine(chatTr, "tr", { name: "DESKTOP-7F3K2LQ", createdAt: at })).toEqual({
      kind: "Windows bilgisayar",
      added: "Eklenme: 3 Kasım 2026",
    });
    expect(deviceLine(chatTr, "tr", { name: "Chrome on Windows", createdAt: at }).kind).toBe(
      "Web tarayıcısı",
    );
    expect(deviceLine(chatEn, "en", { name: "gokalp-rig", createdAt: "" })).toEqual({
      kind: "Device",
      added: null,
    });
  });
});
