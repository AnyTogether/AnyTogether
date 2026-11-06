import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DeviceSecrets,
  type PublicDevice,
  newDevice,
  open,
  openFile,
  publicDevice,
  seal,
  sealFile,
  toBase64,
  unwrapKey,
} from "@anytogether/e2ee";
import { uuidv7 } from "uuidv7";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./harness.js";

const v1 = "/api/v1";
// Several sign-ins per test: slower than most.
vi.setConfig({ testTimeout: 60_000 });
let h: Awaited<ReturnType<typeof harness>>;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "at-e2ee-"));
  h = await harness({ storage: { dir } });
});
afterEach(async () => {
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

type User = Awaited<ReturnType<typeof h.user>>;
/** One signed-in device of a person, with its keys. */
type Device = User & { keys: DeviceSecrets; record: PublicDevice };

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
const direct = async (a: User, b: User) =>
  (await h.call("POST", `${v1}/conversations`, { members: [b.id] }, a.token)).body.id as string;

/** Signs in (again) and registers that session's keys. */
async function device(email: string, name = "Mac"): Promise<Device> {
  const user = await h.user(email);
  const keys = newDevice();
  const record = publicDevice(keys, user.id);
  const made = await h.call("PUT", `${v1}/me/e2ee/device`, { ...record, id: undefined, name }, user.token);
  expect(made.status).toBe(201);
  return { ...user, keys, record };
}

const sealFor = (
  from: Device,
  conversationId: string,
  devices: { id: string; boxKey: string }[],
  payload: Record<string, unknown>,
  messageId = uuidv7(),
) => ({
  messageId,
  ...seal({
    context: { conversationId, messageId, senderUserId: from.id },
    sender: from.keys,
    recipients: devices,
    payload: { v: 1, ...payload },
  }),
});

const sendSealed = (from: Device, conversationId: string, sealed: ReturnType<typeof sealFor>, extra = {}) =>
  h.call(
    "POST",
    `${v1}/conversations/${conversationId}/messages`,
    { clientId: sealed.messageId, sealed: sealed.sealed, ...extra },
    from.token,
  );

describe("device keys", () => {
  it("are registered per session, checked, listed for the person and their friends, and not for strangers", async () => {
    const utku = await device("utku@example.com");
    const ayse = await device("ayse@example.com", "Phone");
    const stranger = await h.user("stranger@example.com");
    await befriend(utku, ayse);

    const mine = await h.call("GET", `${v1}/me/e2ee/device`, undefined, utku.token);
    expect(mine.body).toMatchObject({ id: utku.record.id, name: "Mac", removedAt: null });
    // The same keys again: kept as they are.
    const again = await h.call("PUT", `${v1}/me/e2ee/device`, { ...utku.record, name: "Mac" }, utku.token);
    expect(again.status).toBe(200);
    // A signature for someone else, or over another key, is refused.
    const other = await h.user("utku@example.com");
    const forged = publicDevice(newDevice(), ayse.id);
    const refused = await h.call("PUT", `${v1}/me/e2ee/device`, { ...forged, name: "Mac" }, other.token);
    expect(refused.status).toBe(400);

    const listed = await h.call(
      "GET",
      `${v1}/e2ee/devices?users=${utku.id},${ayse.id},${stranger.id}`,
      undefined,
      utku.token,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.users.map((u: { userId: string }) => u.userId).sort()).toEqual(
      [utku.id, ayse.id].sort(),
    );
    const ayses = listed.body.users.find((u: { userId: string }) => u.userId === ayse.id);
    expect(ayses.devices).toEqual([
      expect.objectContaining({
        id: ayse.record.id,
        signKey: ayse.record.signKey,
        boxKey: ayse.record.boxKey,
        sig: ayse.record.sig,
        name: "Phone",
      }),
    ]);
    const toStranger = await h.call("GET", `${v1}/e2ee/devices?users=${utku.id}`, undefined, stranger.token);
    expect(toStranger.body.users).toEqual([]);
  });

  it("go when their session signs out, stay listed as removed, and the change is told", async () => {
    const utku = await device("utku@example.com");
    const ayse = await device("ayse@example.com");
    await befriend(utku, ayse);
    await direct(utku, ayse);
    const heard = await listen(ayse.id);
    await h.call("POST", `${v1}/auth/logout`, {}, utku.token);
    await settle();
    expect(heard.heard).toContainEqual(
      expect.objectContaining({ type: "e2ee.devices", data: { userId: utku.id } }),
    );
    heard.stop();
    const listed = await h.call("GET", `${v1}/e2ee/devices?users=${utku.id}`, undefined, ayse.token);
    expect(listed.body.users[0].devices).toEqual([]);
    expect(listed.body.users[0].removed).toEqual([expect.objectContaining({ id: utku.record.id })]);
    // Signing in again on the same device brings the same keys back.
    const back = await h.user("utku@example.com");
    const readded = await h.call("PUT", `${v1}/me/e2ee/device`, { ...utku.record, name: "Mac" }, back.token);
    expect(readded.status).toBe(200);
    const after = await h.call("GET", `${v1}/e2ee/devices?users=${utku.id}`, undefined, ayse.token);
    expect(after.body.users[0].devices).toEqual([
      expect.objectContaining({ id: utku.record.id, removedAt: null }),
    ]);
  });

  it("can be removed by hand", async () => {
    const utku = await device("utku@example.com");
    const phone = await device("utku@example.com", "Phone");
    const removed = await h.call("DELETE", `${v1}/me/e2ee/devices/${phone.record.id}`, undefined, utku.token);
    expect(removed.status).toBe(204);
    const listed = await h.call("GET", `${v1}/e2ee/devices?users=${utku.id}`, undefined, utku.token);
    expect(listed.body.users[0].devices.map((d: { id: string }) => d.id)).toEqual([utku.record.id]);
  });
});

describe("sealed messages", () => {
  async function pair() {
    const utkuMac = await device("utku@example.com", "Mac");
    const utkuPhone = await device("utku@example.com", "Phone");
    const ayse = await device("ayse@example.com", "Desktop");
    await befriend(utkuMac, ayse);
    const conversationId = await direct(utkuMac, ayse);
    const all = [utkuMac.record, utkuPhone.record, ayse.record];
    return { utkuMac, utkuPhone, ayse, conversationId, all };
  }

  it("are stored and passed on as ciphertext that every device of both people opens", async () => {
    const { utkuMac, utkuPhone, ayse, conversationId, all } = await pair();
    const heard = await listen(ayse.id);
    const sealed = sealFor(utkuMac, conversationId, all, { text: "selam 🔒" });
    const sent = await sendSealed(utkuMac, conversationId, sealed);
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({
      kind: "text",
      text: "[encrypted message]",
      caption: null,
      sealed: sealed.sealed,
    });
    await settle();
    heard.stop();
    const created = heard.heard.find((e) => e.type === "message.created");
    expect(created?.data.sealed).toEqual(sealed.sealed);
    const thread = await h.call(
      "GET",
      `${v1}/conversations/${conversationId}/messages`,
      undefined,
      ayse.token,
    );
    const stored = thread.body.messages[0];
    for (const reader of [utkuMac, utkuPhone, ayse])
      expect(
        open(stored.sealed, { conversationId, messageId: stored.id, authorId: utkuMac.id }, reader.keys, [
          utkuMac.record,
        ]).text,
      ).toBe("selam 🔒");
    const view = await h.call("GET", `${v1}/conversations/${conversationId}`, undefined, ayse.token);
    expect(view.body.encrypted).toBe(true);
    // The notification says nothing of what it said.
    const notes = await h.call("GET", `${v1}/me/notifications`, undefined, ayse.token);
    const note = notes.body.notifications.find((n: { kind: string }) => n.kind === "message");
    expect(note?.data).toMatchObject({ sealed: true, text: "" });
  });

  it("need a key for exactly the active devices of both people", async () => {
    const { utkuMac, ayse, conversationId, all } = await pair();
    const missing = await sendSealed(
      utkuMac,
      conversationId,
      sealFor(utkuMac, conversationId, [utkuMac.record, ayse.record], { text: "a" }),
    );
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe("e2ee_devices");
    expect(missing.body.devices[utkuMac.id].sort()).toEqual([all[0]?.id, all[1]?.id].sort());
    expect(missing.body.devices[ayse.id]).toEqual([ayse.record.id]);
    const stray = publicDevice(newDevice(), ayse.id);
    const extra = await sendSealed(
      utkuMac,
      conversationId,
      sealFor(utkuMac, conversationId, [...all, stray], { text: "a" }),
    );
    expect(extra.status).toBe(409);
    // Sent from a device that is not the sender's own.
    const notMine = sealFor(ayse, conversationId, all, { text: "a" });
    expect((await sendSealed(utkuMac, conversationId, notMine)).status).toBe(400);
  });

  it("refuse plain text once both people have keys, and stay sealed after", async () => {
    const { utkuMac, utkuPhone, ayse, conversationId, all } = await pair();
    const plain = await h.call(
      "POST",
      `${v1}/conversations/${conversationId}/messages`,
      { clientId: uuidv7(), text: "hi" },
      utkuMac.token,
    );
    expect(plain.status).toBe(409);
    expect(plain.body.code).toBe("e2ee_required");
    expect(
      (await sendSealed(utkuMac, conversationId, sealFor(utkuMac, conversationId, all, { text: "a" })))
        .status,
    ).toBe(201);
    // Ayşe signs out everywhere: no downgrade, and nothing can be sealed for her now.
    await h.call("POST", `${v1}/auth/logout`, {}, ayse.token);
    const later = await h.call(
      "POST",
      `${v1}/conversations/${conversationId}/messages`,
      { clientId: uuidv7(), text: "hi" },
      utkuPhone.token,
    );
    expect(later.status).toBe(409);
    expect(later.body.code).toBe("e2ee_required");
    const forNobody = await sendSealed(
      utkuMac,
      conversationId,
      sealFor(utkuMac, conversationId, all, { text: "a" }),
    );
    expect(forNobody.status).toBe(409);
    expect(forNobody.body.code).toBe("e2ee_devices");
  });

  it("are not for someone without keys (an older app) or a group, where plain text goes on as before", async () => {
    const utku = await device("utku@example.com");
    const old = await h.user("old@example.com");
    const third = await device("third@example.com");
    await befriend(utku, old);
    await befriend(utku, third);
    const conversationId = await direct(utku, old);
    const plain = await h.call(
      "POST",
      `${v1}/conversations/${conversationId}/messages`,
      { clientId: uuidv7(), text: "hi" },
      utku.token,
    );
    expect(plain.status).toBe(201);
    const guessed = publicDevice(newDevice(), old.id);
    const sealedTry = await sendSealed(
      utku,
      conversationId,
      sealFor(utku, conversationId, [utku.record, guessed], { text: "a" }),
    );
    expect(sealedTry.status).toBe(409);
    expect(sealedTry.body.devices[old.id]).toEqual([]);
    const group = await h.call(
      "POST",
      `${v1}/conversations`,
      { members: [old.id, third.id], group: true },
      utku.token,
    );
    const inGroup = await sendSealed(
      utku,
      group.body.id,
      sealFor(utku, group.body.id, [utku.record, third.record], { text: "a" }),
    );
    expect(inGroup.status).toBe(400);
  });

  it("are edited with a new seal and unsent like any other", async () => {
    const { utkuMac, ayse, conversationId, all } = await pair();
    const first = sealFor(utkuMac, conversationId, all, { text: "v1" });
    const sent = await sendSealed(utkuMac, conversationId, first);
    const seq = sent.body.seq;
    const plainEdit = await h.call(
      "PATCH",
      `${v1}/conversations/${conversationId}/messages/${seq}`,
      { text: "v2" },
      utkuMac.token,
    );
    expect(plainEdit.status).toBe(400);
    const second = sealFor(utkuMac, conversationId, all, { text: "v2" }, first.messageId);
    const edited = await h.call(
      "PATCH",
      `${v1}/conversations/${conversationId}/messages/${seq}`,
      { sealed: second.sealed },
      utkuMac.token,
    );
    expect(edited.status).toBe(200);
    expect(edited.body.editCount).toBe(1);
    expect(
      open(
        edited.body.sealed,
        { conversationId, messageId: first.messageId, authorId: utkuMac.id },
        ayse.keys,
        [utkuMac.record],
      ).text,
    ).toBe("v2");
    const unsent = await h.call(
      "DELETE",
      `${v1}/conversations/${conversationId}/messages/${seq}`,
      undefined,
      utkuMac.token,
    );
    expect(unsent.status).toBe(204);
    const thread = await h.call(
      "GET",
      `${v1}/conversations/${conversationId}/messages`,
      undefined,
      ayse.token,
    );
    expect(thread.body.messages[0]).toMatchObject({ deletedAt: expect.any(String), text: null });
    expect(thread.body.messages[0].sealed).toBeUndefined();
  });

  it("carry sealed media only, which the server keeps as it came and nobody pins", async () => {
    const { utkuMac, ayse, conversationId, all } = await pair();
    const picture = new Uint8Array(5000).map((_, i) => (i * 7) % 256);
    const file = sealFile(picture, "file");
    const up = await h.send("POST", `${v1}/me/media/sealed?kind=image`, {
      token: utkuMac.token,
      body: file.ciphertext,
    });
    expect(up.status).toBe(201);
    const media = (await up.json()).media;
    expect(media).toMatchObject({
      kind: "image",
      sealed: true,
      contentType: "application/octet-stream",
      thumb: null,
    });
    // Plain media in a sealed message, or sealed media in a plain one, is refused.
    const plainUp = await h.send("POST", `${v1}/me/media/sealed?kind=voice`, {
      token: utkuMac.token,
      body: new Uint8Array(100),
    });
    expect(plainUp.status).toBe(201);
    const old = await h.user("old@example.com");
    await befriend(utkuMac, old);
    const oldChat = await direct(utkuMac, old);
    const mixed = await h.call(
      "POST",
      `${v1}/conversations/${oldChat}/messages`,
      { clientId: uuidv7(), attachments: [{ mediaId: media.id }] },
      utkuMac.token,
    );
    expect(mixed.status).toBe(400);
    const pinned = await h.call("PUT", `${v1}/me/gallery`, { items: [media.id] }, utkuMac.token);
    expect(pinned.status).toBe(400);

    const sealed = sealFor(utkuMac, conversationId, all, {
      text: "look",
      attachment: {
        mediaId: media.id,
        kind: "image",
        type: "image/webp",
        size: picture.length,
        key: file.key,
        nonce: file.nonce,
      },
    });
    const sent = await sendSealed(utkuMac, conversationId, sealed, { attachments: [{ mediaId: media.id }] });
    expect(sent.status).toBe(201);
    expect(sent.body.kind).toBe("image");
    const thread = await h.call(
      "GET",
      `${v1}/conversations/${conversationId}/messages`,
      undefined,
      ayse.token,
    );
    const message = thread.body.messages[0];
    const link = new URL(message.attachments[0].url);
    const got = await h.send("GET", link.pathname + link.search);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("application/octet-stream");
    const payload = open(
      message.sealed,
      { conversationId, messageId: message.id, authorId: utkuMac.id },
      ayse.keys,
      [utkuMac.record],
    );
    const opened = openFile(
      new Uint8Array(await got.arrayBuffer()),
      "file",
      payload.attachment?.key as string,
      payload.attachment?.nonce as string,
    );
    expect(opened).toEqual(picture);

    // A clip's poster, sealed too.
    const clip = sealFile(new Uint8Array(3000), "file");
    const clipUp = await (
      await h.send("POST", `${v1}/me/media/sealed?kind=clip`, { token: utkuMac.token, body: clip.ciphertext })
    ).json();
    const poster = sealFile(new Uint8Array(400), "poster");
    const posted = await h.send("PUT", `${v1}/me/media/${clipUp.media.id}/poster`, {
      token: utkuMac.token,
      body: poster.ciphertext,
    });
    expect(posted.status).toBe(200);
    expect((await posted.json()).media.poster).toEqual(expect.any(String));
    // Too big for its kind (a voice note is at most 1 MB, plus the tag).
    const big = await h.send("POST", `${v1}/me/media/sealed?kind=voice`, {
      token: utkuMac.token,
      body: new Uint8Array(1024 * 1024 + 17),
    });
    expect(big.status).toBe(413);
    // A plain message cannot carry it, nor a sealed one plain media.
    const sealedWithPlain = sealFor(utkuMac, conversationId, all, { text: "x" });
    expect(
      (await sendSealed(utkuMac, conversationId, sealedWithPlain, { attachments: [{ mediaId: uuidv7() }] }))
        .status,
    ).toBe(400);
  });
});

describe("reporting a sealed message", () => {
  it("needs its content key, and keeps what it said once the key opens it", async () => {
    const utku = await device("utku@example.com");
    const ayse = await device("ayse@example.com");
    await befriend(utku, ayse);
    const conversationId = await direct(utku, ayse);
    const sealed = sealFor(utku, conversationId, [utku.record, ayse.record], { text: "something bad" });
    await sendSealed(utku, conversationId, sealed);
    const report = (contentKey?: string) =>
      h.call(
        "POST",
        `${v1}/reports`,
        {
          targetKind: "message",
          targetId: sealed.messageId,
          reason: "harassment",
          ...(contentKey ? { contentKey } : {}),
        },
        ayse.token,
      );
    expect((await report()).status).toBe(400);
    expect((await report(toBase64(new Uint8Array(32)))).status).toBe(400);
    const key = unwrapKey(
      sealed.sealed,
      { conversationId, messageId: sealed.messageId, senderUserId: utku.id, senderDeviceId: utku.record.id },
      ayse.keys,
    );
    const made = await report(toBase64(key));
    expect(made.status).toBe(201);
    const [row] = await h.deps.db.execute<{ snapshot: Record<string, unknown> }>(
      (await import("drizzle-orm")).sql`select snapshot from reports where target_id = ${sealed.messageId}`,
    );
    expect(row?.snapshot).toMatchObject({
      text: "something bad",
      sealed: { verified: true, device: utku.record.id },
    });
  });
});
