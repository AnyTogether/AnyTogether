import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type StorageOptions, harness } from "./harness.js";
import { jpegWithExif, mp4, oggOpus, png, webmOpus } from "./mediaFixtures.js";

const v1 = "/api/v1";
const mb = 1024 * 1024;
let h: Awaited<ReturnType<typeof harness>>;
let dir: string;
let clock = Date.now();

async function start(storage: Partial<StorageOptions> = {}) {
  dir = await mkdtemp(join(tmpdir(), "at-media-"));
  clock = Date.now();
  h = await harness({ storage: { dir, now: () => clock, ...storage } });
}
afterEach(async () => {
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

type User = Awaited<ReturnType<typeof h.user>>;

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
async function uploadMedia(user: User, kind: string, bytes: Uint8Array, type = "application/octet-stream") {
  const response = await h.send("POST", `${v1}/me/media?kind=${kind}`, {
    token: user.token,
    body: bytes,
    headers: { "content-type": type },
  });
  return { status: response.status, body: await response.json() };
}
/** Fetches a signed link as anyone would (no token). */
const fetchLink = (link: string, headers: Record<string, string> = {}) => {
  const url = new URL(link);
  return h.send("GET", url.pathname + url.search, { headers });
};
const direct = async (a: User, b: User) =>
  (await h.call("POST", `${v1}/conversations`, { members: [b.id] }, a.token)).body.id as string;
const sendMessage = (user: User, conversationId: string, body: Record<string, unknown>) =>
  h.call(
    "POST",
    `${v1}/conversations/${conversationId}/messages`,
    { clientId: uuidv7(), ...body },
    user.token,
  );
const thread = async (user: User, conversationId: string) =>
  (await h.call("GET", `${v1}/conversations/${conversationId}/messages`, undefined, user.token)).body
    .messages;

describe("media uploads", () => {
  beforeEach(() => start());

  it("re-encode pictures as WebP without their metadata, with a small one for lists", async () => {
    const me = await h.user("utku@example.com");
    const sent = await uploadMedia(me, "image", await jpegWithExif(320, 200), "image/jpeg");
    expect(sent.status).toBe(201);
    expect(sent.body.media).toMatchObject({
      kind: "image",
      contentType: "image/webp",
      width: 320,
      height: 200,
    });
    const file = await fetchLink(sent.body.media.url);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/webp");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect((await fetchLink(sent.body.media.thumb)).status).toBe(200);
    // The usage counts the picture and its thumbnail.
    expect(sent.body.usage.media).toBe(sent.body.media.size);
    expect(sent.body.usage.used).toBe(sent.body.media.size);
  });

  it("refuse what is not a picture, and pictures that are too big", async () => {
    const me = await h.user("utku@example.com");
    const fake = await uploadMedia(me, "image", Buffer.from("GIF89a not really"));
    expect(fake.status).toBe(415);
    const broken = await uploadMedia(
      me,
      "image",
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]),
    );
    expect(broken.status).toBe(400);
    expect(broken.body.code).toBe("bad_image");
    const huge = await uploadMedia(me, "image", Buffer.alloc(10 * mb + 1));
    expect(huge.status).toBe(413);
    expect(huge.body.code).toBe("payload_too_large");
    expect((await uploadMedia(me, "gif", await png())).status).toBe(400);
  });

  it("take H.264 clips as they are, with a poster from the client", async () => {
    const me = await h.user("utku@example.com");
    const clip = mp4({ seconds: 12, width: 1920, height: 1080 });
    const sent = await uploadMedia(me, "clip", clip, "video/mp4");
    expect(sent.status).toBe(201);
    expect(sent.body.media).toMatchObject({
      kind: "clip",
      contentType: "video/mp4",
      durationMs: 12_000,
      width: 1920,
      height: 1080,
      size: clip.length,
      poster: null,
    });
    const served = await fetchLink(sent.body.media.url, { range: "bytes=0-99" });
    expect(served.status).toBe(206);
    expect(Buffer.from(await served.arrayBuffer())).toEqual(clip.subarray(0, 100));
    const poster = await h.send("PUT", `${v1}/me/media/${sent.body.media.id}/poster`, {
      token: me.token,
      body: await png(640, 360),
    });
    expect(poster.status).toBe(200);
    const withPoster = (await poster.json()).media;
    expect(withPoster.poster).toBeTruthy();
    expect((await fetchLink(withPoster.poster)).headers.get("content-type")).toBe("image/webp");
    // HEVC, a missing moov and no video at all are refused.
    expect((await uploadMedia(me, "clip", mp4({ video: "hvc1" }))).body.code).toBe("bad_media");
    const cut = clip.subarray(0, 40);
    expect((await uploadMedia(me, "clip", cut)).body.code).toBe("bad_media");
    expect((await uploadMedia(me, "clip", mp4({ video: null as unknown as string }))).body.code).toBe(
      "bad_media",
    );
    expect((await uploadMedia(me, "clip", await png())).status).toBe(415);
  });

  it("take voice notes in Ogg or WebM Opus and M4A, up to a minute", async () => {
    const me = await h.user("utku@example.com");
    const ogg = await uploadMedia(me, "voice", oggOpus(5), "audio/ogg");
    expect(ogg.status).toBe(201);
    expect(ogg.body.media).toMatchObject({ kind: "voice", contentType: "audio/ogg", durationMs: 5000 });
    const webm = await uploadMedia(me, "voice", webmOpus(30), "audio/webm");
    expect(webm.status).toBe(201);
    expect(webm.body.media.contentType).toBe("audio/webm");
    expect(webm.body.media.durationMs).toBeGreaterThanOrEqual(28_000);
    const m4a = await uploadMedia(
      me,
      "voice",
      mp4({ video: null as unknown as string, audio: "mp4a", seconds: 8 }),
    );
    expect(m4a.status).toBe(201);
    expect(m4a.body.media).toMatchObject({ contentType: "audio/mp4", durationMs: 8000 });
    const long = await uploadMedia(me, "voice", webmOpus(65));
    expect(long.status).toBe(400);
    expect(long.body.code).toBe("bad_media");
    expect((await uploadMedia(me, "voice", oggOpus(61))).body.code).toBe("bad_media");
    expect((await uploadMedia(me, "voice", webmOpus(5, "A_VORBIS"))).body.code).toBe("bad_media");
    expect((await uploadMedia(me, "voice", mp4())).body.code).toBe("bad_media");
    expect((await uploadMedia(me, "voice", Buffer.alloc(mb + 1))).status).toBe(413);
  });

  it("count against the quota", async () => {
    await h.close();
    await rm(dir, { recursive: true, force: true });
    const quota = mp4().length + 100;
    await start({ quotaBytes: quota });
    const me = await h.user("utku@example.com");
    expect((await uploadMedia(me, "voice", oggOpus(5))).status).toBe(201);
    const full = await uploadMedia(me, "clip", mp4());
    expect(full.status).toBe(413);
    expect(full.body).toMatchObject({ code: "quota_exceeded", limit: quota });
    expect(full.body.used).toBeGreaterThan(0);
    expect(full.body.needed).toBe(mp4().length);
  });

  it("are listed, and deleted, by their owner", async () => {
    const me = await h.user("utku@example.com");
    const other = await h.user("ayse@example.com");
    const a = await uploadMedia(me, "image", await png());
    const b = await uploadMedia(me, "voice", oggOpus(3));
    const storage = await h.call("GET", `${v1}/me/storage`, undefined, me.token);
    expect(storage.body).toMatchObject({ enabled: true, limits: { quota: 100 * mb }, saves: [] });
    expect(storage.body.media.map((m: { id: string }) => m.id)).toEqual([b.body.media.id, a.body.media.id]);
    expect((await h.call("DELETE", `${v1}/me/media/${a.body.media.id}`, undefined, other.token)).status).toBe(
      404,
    );
    const gone = await h.call("DELETE", `${v1}/me/media/${a.body.media.id}`, undefined, me.token);
    expect(gone.body.usage.used).toBe(b.body.media.size);
    expect((await fetchLink(a.body.media.url)).status).toBe(404);
  });
});

describe("media in messages", () => {
  beforeEach(() => start());

  it("reach the members, with a stand-in for clients that know no media", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const stranger = await h.user("stranger@example.com");
    await befriend(utku, ayse);
    const chat = await direct(utku, ayse);
    const photo = await uploadMedia(utku, "image", await png());
    const sent = await sendMessage(utku, chat, { attachments: [{ mediaId: photo.body.media.id }] });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ kind: "image", text: "[photo]", caption: null });
    const captioned = await sendMessage(utku, chat, {
      text: "look at this",
      attachments: [{ mediaId: photo.body.media.id }],
    });
    expect(captioned.body).toMatchObject({ kind: "image", text: "look at this", caption: "look at this" });
    const [first, second] = await thread(ayse, chat);
    expect(first.attachments[0]).toMatchObject({
      id: photo.body.media.id,
      kind: "image",
      contentType: "image/webp",
    });
    expect(second.caption).toBe("look at this");
    expect((await fetchLink(first.attachments[0].url)).status).toBe(200);
    // The conversation list shows the newest, with its kind.
    const list = await h.call("GET", `${v1}/me/conversations`, undefined, ayse.token);
    expect(list.body.conversations[0].lastMessage).toMatchObject({ kind: "image", text: "look at this" });
    // Someone else's media cannot be sent, and a message needs text or media.
    const theirs = await uploadMedia(stranger, "image", await png());
    expect((await sendMessage(utku, chat, { attachments: [{ mediaId: theirs.body.media.id }] })).status).toBe(
      400,
    );
    expect((await sendMessage(utku, chat, {})).status).toBe(400);
    expect((await sendMessage(utku, chat, { text: "  " })).status).toBe(400);
    const notes = await h.call("GET", `${v1}/me/notifications`, undefined, ayse.token);
    expect(JSON.stringify(notes.body)).toContain("look at this");
  });

  it("are not shown across a block, even in a group", async () => {
    const host = await h.user("host@example.com");
    const a = await h.user("a@example.com");
    const c = await h.user("c@example.com");
    await befriend(host, a);
    await befriend(host, c);
    const group = (
      await h.call("POST", `${v1}/conversations`, { members: [a.id, c.id], group: true }, host.token)
    ).body.id;
    await h.call("POST", `${v1}/me/blocks`, { userId: c.id }, a.token);
    const photo = await uploadMedia(c, "image", await png());
    expect((await sendMessage(c, group, { attachments: [{ mediaId: photo.body.media.id }] })).status).toBe(
      201,
    );
    const seenByA = (await thread(a, group)).at(-1);
    expect(seenByA.attachments[0]).toEqual({ id: photo.body.media.id, kind: "image", blocked: true });
    const seenByHost = (await thread(host, group)).at(-1);
    expect(seenByHost.attachments[0].url).toBeTruthy();
    // Nor can A report what A cannot see.
    expect(
      (
        await h.call(
          "POST",
          `${v1}/reports`,
          { targetKind: "media", targetId: photo.body.media.id, reason: "spam" },
          a.token,
        )
      ).status,
    ).toBe(404);
  });

  it("go when their message is deleted, unless pinned", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const chat = await direct(utku, ayse);
    const loose = await uploadMedia(utku, "image", await png(60, 60));
    const pinned = await uploadMedia(utku, "image", await png(70, 70));
    await h.call("PUT", `${v1}/me/gallery`, { items: [pinned.body.media.id] }, utku.token);
    const m1 = await sendMessage(utku, chat, { attachments: [{ mediaId: loose.body.media.id }] });
    const m2 = await sendMessage(utku, chat, { attachments: [{ mediaId: pinned.body.media.id }] });
    await h.call("DELETE", `${v1}/conversations/${chat}/messages/${m1.body.seq}`, undefined, utku.token);
    await h.call("DELETE", `${v1}/conversations/${chat}/messages/${m2.body.seq}`, undefined, utku.token);
    const left = (await h.call("GET", `${v1}/me/media`, undefined, utku.token)).body.media.map(
      (m: { id: string }) => m.id,
    );
    expect(left).toEqual([pinned.body.media.id]);
  });

  it("show as removed once their owner deletes them", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const chat = await direct(utku, ayse);
    const note = await uploadMedia(utku, "voice", oggOpus(4));
    await sendMessage(utku, chat, { attachments: [{ mediaId: note.body.media.id }] });
    await h.call("DELETE", `${v1}/me/media/${note.body.media.id}`, undefined, utku.token);
    expect((await thread(ayse, chat))[0]).toMatchObject({
      kind: "voice",
      text: "[voice note]",
      attachments: [{ id: note.body.media.id, kind: "voice", removed: true }],
    });
  });

  it("are left out after a day when nobody sent or pinned them", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const chat = await direct(utku, ayse);
    const used = await uploadMedia(utku, "image", await png(50, 50));
    const unused = await uploadMedia(utku, "image", await png(90, 90));
    await sendMessage(utku, chat, { attachments: [{ mediaId: used.body.media.id }] });
    clock = Date.now() + 25 * 3600_000;
    const swept = await h.deps.files?.sweep();
    expect(swept?.media).toBe(1);
    const left = (await h.call("GET", `${v1}/me/media`, undefined, utku.token)).body.media.map(
      (m: { id: string }) => m.id,
    );
    expect(left).toEqual([used.body.media.id]);
    const [row] = await h.deps.db.execute<{ used: string; files: string }>(sql`
      select (select used_bytes from storage_accounts where account_id = ${utku.id}) used,
        (select sum(size) from stored_files where account_id = ${utku.id}) files`);
    expect(Number(row?.used)).toBe(Number(row?.files));
    void unused;
  });
});

describe("the gallery", () => {
  beforeEach(() => start());

  it("shows pinned photos and clips as the owner's setting allows", async () => {
    const utku = await h.user("utku@example.com");
    const friend = await h.user("friend@example.com");
    const stranger = await h.user("stranger@example.com");
    await befriend(utku, friend);
    const shot = await uploadMedia(utku, "image", await png());
    const clip = await uploadMedia(utku, "clip", mp4());
    const voice = await uploadMedia(utku, "voice", oggOpus(2));
    expect(
      (await h.call("PUT", `${v1}/me/gallery`, { items: [voice.body.media.id] }, utku.token)).status,
    ).toBe(400);
    const pinned = await h.call(
      "PUT",
      `${v1}/me/gallery`,
      { items: [clip.body.media.id, shot.body.media.id] },
      utku.token,
    );
    expect(pinned.body.items.map((m: { id: string; gallery: number }) => [m.id, m.gallery])).toEqual([
      [clip.body.media.id, 0],
      [shot.body.media.id, 1],
    ]);
    const gallery = (user: User) => h.call("GET", `${v1}/users/utku/gallery`, undefined, user.token);
    // Friends by default.
    expect((await gallery(friend)).body.items).toHaveLength(2);
    expect((await gallery(stranger)).status).toBe(403);
    const privateLink = (await gallery(friend)).body.items[1].url;
    expect((await fetchLink(privateLink)).headers.get("cache-control")).toMatch(/^private/);
    await h.call("PATCH", `${v1}/me/privacy`, { gallery: "everyone" }, utku.token);
    const open = await gallery(stranger);
    expect(open.body.items).toHaveLength(2);
    expect((await fetchLink(open.body.items[1].url)).headers.get("cache-control")).toMatch(
      /^public, max-age=\d+, immutable$/,
    );
    await h.call("PATCH", `${v1}/me/privacy`, { gallery: "nobody" }, utku.token);
    expect((await gallery(friend)).status).toBe(403);
    expect((await gallery(utku)).body.items).toHaveLength(2);
    // Blocked: no profile, no gallery.
    await h.call("PATCH", `${v1}/me/privacy`, { gallery: "everyone" }, utku.token);
    await h.call("POST", `${v1}/me/blocks`, { userId: stranger.id }, utku.token);
    expect((await gallery(stranger)).status).toBe(404);
    // At most twelve, and only one's own.
    const many = Array.from({ length: 13 }, () => uuidv7());
    expect((await h.call("PUT", `${v1}/me/gallery`, { items: many }, utku.token)).status).toBe(400);
    expect(
      (await h.call("PUT", `${v1}/me/gallery`, { items: [shot.body.media.id] }, friend.token)).status,
    ).toBe(400);
    expect((await h.call("PUT", `${v1}/me/gallery`, { items: [] }, utku.token)).body.items).toEqual([]);
  });

  it("links expire with their window", async () => {
    const utku = await h.user("utku@example.com");
    const shot = await uploadMedia(utku, "image", await png());
    await h.call("PUT", `${v1}/me/gallery`, { items: [shot.body.media.id] }, utku.token);
    const link = (await h.call("GET", `${v1}/users/utku/gallery`, undefined, utku.token)).body.items[0].url;
    const expires = Number(new URL(link).searchParams.get("e")) * 1000;
    expect(expires - clock).toBeGreaterThanOrEqual(12 * 3600_000);
    expect(expires - clock).toBeLessThanOrEqual(24 * 3600_000);
    // The same link all through the window, so it can be cached.
    clock += 60_000;
    const again = (await h.call("GET", `${v1}/users/utku/gallery`, undefined, utku.token)).body.items[0].url;
    if (Math.floor(clock / (12 * 3600_000)) === Math.floor((clock - 60_000) / (12 * 3600_000)))
      expect(again).toBe(link);
    clock = expires + 1;
    expect((await fetchLink(link)).status).toBe(410);
  });
});

describe("moderating media", () => {
  beforeEach(() => start());

  it("hides or deletes reported media", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const admin = await h.user("admin@example.com");
    await h.deps.db.execute(sql`update accounts set role = 'admin' where id = ${admin.id}`);
    await befriend(utku, ayse);
    const chat = await direct(utku, ayse);
    const photo = await uploadMedia(utku, "image", await png());
    await sendMessage(utku, chat, { attachments: [{ mediaId: photo.body.media.id }] });
    expect(
      (
        await h.call(
          "POST",
          `${v1}/reports`,
          { targetKind: "media", targetId: photo.body.media.id, reason: "sexual" },
          utku.token,
        )
      ).status,
    ).toBe(400);
    const reported = await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "media", targetId: photo.body.media.id, reason: "sexual" },
      ayse.token,
    );
    expect(reported.status).toBe(201);
    const queue = await h.call("GET", `${v1}/admin/reports`, undefined, admin.token);
    const report = queue.body.reports[0];
    expect(report).toMatchObject({
      targetKind: "media",
      media: { id: photo.body.media.id, kind: "image", status: "active" },
    });
    expect((await fetchLink(report.media.view.url)).status).toBe(200);

    const hidden = await h.call(
      "POST",
      `${v1}/admin/reports/${report.id}`,
      { action: "hide_media" },
      admin.token,
    );
    expect(hidden.status).toBe(200);
    expect((await thread(ayse, chat))[0].attachments[0]).toEqual({
      id: photo.body.media.id,
      kind: "image",
      removed: true,
    });
    expect((await fetchLink((await thread(utku, chat))[0].attachments[0].url)).status).toBe(200);
    expect((await thread(utku, chat))[0].attachments[0].hidden).toBe(true);
    // A link made earlier for a member stops working.
    const sentLink = (await h.call("GET", `${v1}/me/media`, undefined, utku.token)).body.media[0].url.replace(
      "&o=1",
      "",
    );
    expect((await fetchLink(sentLink)).status).toBe(403);

    const again = await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "media", targetId: photo.body.media.id, reason: "spam" },
      ayse.token,
    );
    expect(again.status).toBe(404);
    const second = await uploadMedia(utku, "image", await png(80, 80));
    await sendMessage(utku, chat, { attachments: [{ mediaId: second.body.media.id }] });
    await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "media", targetId: second.body.media.id, reason: "spam" },
      ayse.token,
    );
    const next = (await h.call("GET", `${v1}/admin/reports`, undefined, admin.token)).body.reports[0];
    expect(
      (await h.call("POST", `${v1}/admin/reports/${next.id}`, { action: "delete_media" }, admin.token))
        .status,
    ).toBe(200);
    expect(
      (await h.call("GET", `${v1}/me/media`, undefined, utku.token)).body.media.map(
        (m: { id: string }) => m.id,
      ),
    ).toEqual([photo.body.media.id]);
  });
});
