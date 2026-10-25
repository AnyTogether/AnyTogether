import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type StorageOptions, harness } from "./harness.js";

const v1 = "/api/v1";
const mb = 1024 * 1024;
let h: Awaited<ReturnType<typeof harness>>;
let dir: string;
let clock = Date.now();

async function start(storage: Partial<StorageOptions> = {}) {
  dir = await mkdtemp(join(tmpdir(), "at-files-"));
  clock = Date.now();
  h = await harness({ storage: { dir, now: () => clock, ...storage } });
}
afterEach(async () => {
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

type User = Awaited<ReturnType<typeof h.user>>;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Begins an upload of `bytes` for a slot. */
const init = (user: User, bytes: Uint8Array, more: Record<string, unknown> = {}) =>
  h.call(
    "POST",
    `${v1}/me/saves/uploads`,
    {
      titleId: "CUSA12345",
      slot: "SAVEDATA00",
      size: bytes.length,
      sha256: sha(bytes),
      device: "Mac Studio",
      launcherVersion: "0.2.13",
      ...more,
    },
    user.token,
  );
const part = (user: User, id: string, n: number, bytes: Uint8Array, headers: Record<string, string> = {}) =>
  h.send("PUT", `${v1}/me/saves/uploads/${id}/parts/${n}`, { token: user.token, body: bytes, headers });
const complete = (user: User, id: string, more: Record<string, unknown> = {}) =>
  h.call("POST", `${v1}/me/saves/uploads/${id}/complete`, more, user.token);

/** A whole upload: begin, every part, complete. */
async function upload(user: User, bytes: Uint8Array, more: Record<string, unknown> = {}) {
  const begun = await init(user, bytes, more);
  if (begun.status !== 201) return begun;
  const { uploadId, partSize, parts } = begun.body;
  for (let n = 1; n <= parts; n++) {
    const sent = await part(user, uploadId, n, bytes.subarray((n - 1) * partSize, n * partSize));
    expect(sent.status).toBe(200);
  }
  return complete(user, uploadId, more.replaceLatest ? { replaceLatest: true } : {});
}

const usedInDb = async (accountId: string) => {
  const [row] = await h.deps.db.execute<{ used: string; files: string }>(sql`
    select coalesce((select used_bytes from storage_accounts where account_id = ${accountId}), 0) used,
      coalesce((select sum(size) from stored_files where account_id = ${accountId}), 0) files`);
  return { used: Number(row?.used), files: Number(row?.files) };
};
const objectsOf = async (accountId: string) => {
  const found: string[] = [];
  const walk = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => []))
      entry.isDirectory() ? await walk(join(path, entry.name)) : found.push(entry.name);
  };
  await walk(join(dir, accountId));
  return found;
};

describe("storage switched off", () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "at-files-"));
    h = await harness();
  });

  it("says so, and every storage route answers 503 storage_disabled", async () => {
    const me = await h.user("utku@example.com");
    expect((await h.call("GET", `${v1}/storage`)).body).toEqual({ enabled: false });
    expect((await h.call("GET", `${v1}/me/storage`, undefined, me.token)).body).toEqual({ enabled: false });
    const begun = await init(me, Buffer.from("save"));
    expect(begun.status).toBe(503);
    expect(begun.body.code).toBe("storage_disabled");
    expect(
      (await h.send("POST", `${v1}/me/media?kind=image`, { token: me.token, body: Buffer.from("x") })).status,
    ).toBe(503);
    expect((await h.call("GET", `${v1}/me/saves`, undefined, me.token)).status).toBe(503);
  });
});

describe("cloud saves", () => {
  beforeEach(() => start());

  it("say what the server allows", async () => {
    const info = (await h.call("GET", `${v1}/storage`)).body;
    expect(info).toMatchObject({
      enabled: true,
      quota: 100 * mb,
      saveMax: 50 * mb,
      saveVersions: 3,
      partSize: 4 * mb,
      galleryMax: 12,
    });
  });

  it("upload in parts, in any order and again, and come back whole", async () => {
    const me = await h.user("utku@example.com");
    const bytes = randomBytes(9 * mb + 123);
    const begun = await init(me, bytes);
    expect(begun.status).toBe(201);
    expect(begun.body).toMatchObject({ parts: 3, partSize: 4 * mb, received: [] });
    const id = begun.body.uploadId;
    const piece = (n: number) => bytes.subarray((n - 1) * 4 * mb, n * 4 * mb);
    expect((await part(me, id, 3, piece(3))).status).toBe(200);
    expect((await part(me, id, 1, piece(1))).status).toBe(200);
    // A part of the wrong size, a damaged part and a part past the end are refused.
    expect((await part(me, id, 2, piece(2).subarray(10))).status).toBe(400);
    const damaged = await part(me, id, 2, piece(2), { "x-part-sha256": sha(piece(1)) });
    expect(damaged.status).toBe(400);
    expect((await damaged.json()).code).toBe("checksum_mismatch");
    expect((await part(me, id, 4, piece(1))).status).toBe(400);
    // Resuming: the upload says what it has.
    const status = await h.call("GET", `${v1}/me/saves/uploads/${id}`, undefined, me.token);
    expect(status.body.received).toEqual([1, 3]);
    const early = await complete(me, id);
    expect(early.status).toBe(409);
    expect(early.body.missing).toEqual([2]);
    expect((await part(me, id, 2, piece(2), { "x-part-sha256": sha(piece(2)) })).status).toBe(200);
    expect((await part(me, id, 2, piece(2))).status).toBe(200);
    const done = await complete(me, id);
    expect(done.status).toBe(201);
    expect(done.body.version).toMatchObject({
      version: 1,
      size: bytes.length,
      sha256: sha(bytes),
      device: "Mac Studio",
      launcherVersion: "0.2.13",
    });
    expect(done.body.save).toMatchObject({ titleId: "CUSA12345", slot: "SAVEDATA00" });
    expect(done.body.usage).toEqual({ used: bytes.length, limit: 100 * mb, saves: bytes.length, media: 0 });
    expect(await usedInDb(me.id)).toEqual({ used: bytes.length, files: bytes.length });
    // The upload is gone; the archive comes back as sent, whole or by range.
    expect((await h.call("GET", `${v1}/me/saves/uploads/${id}`, undefined, me.token)).status).toBe(404);
    const versionId = done.body.version.id;
    const whole = await h.send("GET", `${v1}/me/saves/versions/${versionId}/download`, { token: me.token });
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("application/zip");
    expect(sha(new Uint8Array(await whole.arrayBuffer()))).toBe(sha(bytes));
    const ranged = await h.send("GET", `${v1}/me/saves/versions/${versionId}/download`, {
      token: me.token,
      headers: { range: "bytes=100-199" },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe(`bytes 100-199/${bytes.length}`);
    expect(Buffer.from(await ranged.arrayBuffer())).toEqual(bytes.subarray(100, 200));
    // The signed link from the list works without the token.
    const link = new URL(done.body.version.download);
    const signed = await h.send("GET", link.pathname + link.search);
    expect(signed.status).toBe(200);
    expect(signed.headers.get("content-disposition")).toContain("cusa12345-savedata00-v1.zip");
    expect(sha(new Uint8Array(await signed.arrayBuffer()))).toBe(sha(bytes));
  });

  it("refuse a save whose bytes do not match its SHA-256, and drop the upload", async () => {
    const me = await h.user("utku@example.com");
    const bytes = randomBytes(1000);
    const begun = await init(me, bytes, { sha256: sha(Buffer.from("other")) });
    await part(me, begun.body.uploadId, 1, bytes);
    const done = await complete(me, begun.body.uploadId);
    expect(done.status).toBe(400);
    expect(done.body.code).toBe("checksum_mismatch");
    expect(
      (await h.call("GET", `${v1}/me/saves/uploads/${begun.body.uploadId}`, undefined, me.token)).status,
    ).toBe(404);
    expect((await h.call("GET", `${v1}/me/saves`, undefined, me.token)).body.slots).toEqual([]);
    expect(await readdir(join(dir, ".staging"))).toEqual([]);
  });

  it("keep the newest three versions, and the same bytes again change nothing", async () => {
    const me = await h.user("utku@example.com");
    const saves = [1, 2, 3, 4].map(() => randomBytes(1000));
    const results = [];
    for (const bytes of saves) results.push(await upload(me, bytes));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(results[3]?.body.dropped).toEqual([
      { id: results[0]?.body.version.id, version: 1, size: 1000, reason: "kept" },
    ]);
    const list = await h.call("GET", `${v1}/me/saves?titleId=CUSA12345`, undefined, me.token);
    expect(list.body.slots[0].versions.map((v: { version: number }) => v.version)).toEqual([4, 3, 2]);
    expect(list.body.usage.used).toBe(3000);
    expect(await usedInDb(me.id)).toEqual({ used: 3000, files: 3000 });
    expect((await objectsOf(me.id)).sort()).toEqual(saves.slice(1).map(sha).sort());
    const again = await upload(me, saves[3] as Buffer);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ unchanged: true, version: { version: 4 } });
  });

  it("answer a stale base version with 409 save_conflict and the newer save", async () => {
    const me = await h.user("utku@example.com");
    const first = await upload(me, randomBytes(500), { baseVersion: 0 });
    expect(first.status).toBe(201);
    // Another device thinks there is nothing yet.
    const stale = await init(me, randomBytes(500), { baseVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("save_conflict");
    expect(stale.body.latest).toMatchObject({ version: 1, device: "Mac Studio" });
    // Two devices begin from version 1; the second to complete learns of the first.
    const mine = randomBytes(600);
    const a = await init(me, mine, { baseVersion: 1 });
    expect(a.status).toBe(201);
    await part(me, a.body.uploadId, 1, mine);
    expect((await upload(me, randomBytes(700), { baseVersion: 1, device: "Steam Deck" })).status).toBe(201);
    const late = await complete(me, a.body.uploadId);
    expect(late.status).toBe(409);
    expect(late.body.latest).toMatchObject({ version: 2, device: "Steam Deck" });
    // The player chose to keep this one: completed again over version 2, no new upload needed.
    const kept = await complete(me, a.body.uploadId, { baseVersion: 2 });
    expect(kept.status).toBe(201);
    expect(kept.body.version).toMatchObject({ version: 3, sha256: sha(mine) });
  });

  it("restore an older version as the newest, counting nothing more", async () => {
    const me = await h.user("utku@example.com");
    const one = randomBytes(800);
    const v1r = await upload(me, one);
    await upload(me, randomBytes(800));
    await upload(me, randomBytes(800));
    const restored = await h.call(
      "POST",
      `${v1}/me/saves/versions/${v1r.body.version.id}/restore`,
      {},
      me.token,
    );
    expect(restored.status).toBe(200);
    expect(restored.body.version).toMatchObject({ version: 4, sha256: sha(one) });
    // Version 1 made way (three kept), but its bytes live on as version 4.
    expect(restored.body.save.versions.map((v: { version: number }) => v.version)).toEqual([4, 3, 2]);
    expect(restored.body.usage.used).toBe(2400);
    expect(await usedInDb(me.id)).toEqual({ used: 2400, files: 2400 });
  });

  it("delete a version or a whole slot, and their files with them", async () => {
    const me = await h.user("utku@example.com");
    const a = await upload(me, randomBytes(1000));
    const b = await upload(me, randomBytes(2000));
    const gone = await h.call("DELETE", `${v1}/me/saves/versions/${a.body.version.id}`, undefined, me.token);
    expect(gone.body.usage.used).toBe(2000);
    expect(await objectsOf(me.id)).toEqual([b.body.version.sha256]);
    const other = await upload(me, randomBytes(300), { slot: "autosave" });
    expect(
      (await h.call("DELETE", `${v1}/me/saves/slots/${b.body.save.id}`, undefined, me.token)).body.usage.used,
    ).toBe(300);
    expect(await objectsOf(me.id)).toEqual([other.body.version.sha256]);
    expect(
      (await h.call("GET", `${v1}/me/saves`, undefined, me.token)).body.slots.map(
        (s: { slot: string }) => s.slot,
      ),
    ).toEqual(["autosave"]);
  });

  it("are their owner's alone", async () => {
    const me = await h.user("utku@example.com");
    const other = await h.user("ayse@example.com");
    const bytes = randomBytes(1000);
    const begun = await init(me, bytes);
    const id = begun.body.uploadId;
    expect((await h.call("GET", `${v1}/me/saves/uploads/${id}`, undefined, other.token)).status).toBe(404);
    expect((await part(other, id, 1, bytes)).status).toBe(404);
    expect((await complete(other, id)).status).toBe(404);
    await part(me, id, 1, bytes);
    const done = await complete(me, id);
    const versionId = done.body.version.id;
    expect(
      (await h.send("GET", `${v1}/me/saves/versions/${versionId}/download`, { token: other.token })).status,
    ).toBe(404);
    expect(
      (await h.call("POST", `${v1}/me/saves/versions/${versionId}/restore`, {}, other.token)).status,
    ).toBe(404);
    expect(
      (await h.call("DELETE", `${v1}/me/saves/versions/${versionId}`, undefined, other.token)).status,
    ).toBe(404);
    expect(
      (await h.call("DELETE", `${v1}/me/saves/slots/${done.body.save.id}`, undefined, other.token)).status,
    ).toBe(404);
    expect((await h.call("GET", `${v1}/me/saves`, undefined, other.token)).body.slots).toEqual([]);
    expect((await h.send("GET", `${v1}/me/saves/versions/${versionId}/download`)).status).toBe(401);
  });

  it("hand out links that stop working when they expire or are changed", async () => {
    const me = await h.user("utku@example.com");
    const done = await upload(me, randomBytes(100));
    const link = new URL(done.body.version.download);
    const path = link.pathname;
    const s = link.searchParams.get("s") as string;
    const e = Number(link.searchParams.get("e"));
    // At least an hour, at most two.
    expect(e * 1000 - clock).toBeGreaterThanOrEqual(3600_000);
    expect(e * 1000 - clock).toBeLessThanOrEqual(7200_000);
    const tampered = await h.send("GET", `${path}?e=${e + 3600}&o=1&s=${s}`);
    expect(tampered.status).toBe(403);
    expect((await tampered.json()).code).toBe("link_expired");
    expect((await h.send("GET", `${path}?e=${e}&s=${s}`)).status).toBe(403);
    const otherVersion = path.replace(/save\/[0-9a-f-]{36}/, "save/00000000-0000-7000-8000-000000000000");
    expect((await h.send("GET", `${otherVersion}${link.search}`)).status).toBe(403);
    clock = e * 1000 + 1000;
    const expired = await h.send("GET", path + link.search);
    expect(expired.status).toBe(410);
    expect((await expired.json()).code).toBe("link_expired");
  });

  it("refuse a save bigger than the server allows before any byte is sent", async () => {
    const me = await h.user("utku@example.com");
    const big = await h.call(
      "POST",
      `${v1}/me/saves/uploads`,
      { titleId: "CUSA12345", slot: "a", size: 51 * mb, sha256: "a".repeat(64) },
      me.token,
    );
    expect(big.status).toBe(413);
    expect(big.body).toMatchObject({ code: "payload_too_large", max: 50 * mb });
    const bad = await h.call(
      "POST",
      `${v1}/me/saves/uploads`,
      { titleId: "nope", slot: "a/b", size: 1, sha256: "x" },
      me.token,
    );
    expect(bad.status).toBe(400);
  });

  it("allow at most three unfinished uploads at once", async () => {
    const me = await h.user("utku@example.com");
    for (const slot of ["a", "b", "c"]) expect((await init(me, randomBytes(10), { slot })).status).toBe(201);
    expect((await init(me, randomBytes(10), { slot: "d" })).status).toBe(409);
  });
});

describe("the quota", () => {
  beforeEach(() => start({ quotaBytes: 3 * mb }));

  it("makes room from the same slot's older versions, never from other slots", async () => {
    const me = await h.user("utku@example.com");
    const size = Math.round(1.2 * mb);
    const a1 = await upload(me, randomBytes(size));
    const a2 = await upload(me, randomBytes(size));
    expect(a2.body.usage.used).toBe(2 * size);
    // A third would pass 3 MB: the oldest goes to make room.
    const a3 = await upload(me, randomBytes(size));
    expect(a3.status).toBe(201);
    expect(a3.body.dropped).toEqual([{ id: a1.body.version.id, version: 1, size, reason: "quota" }]);
    expect(a3.body.usage.used).toBe(2 * size);
    // Another game's save may not push this one's versions out: 413 with the numbers.
    const other = await init(me, randomBytes(mb), { titleId: "PPSA01234" });
    expect(other.status).toBe(413);
    expect(other.body).toMatchObject({
      code: "quota_exceeded",
      used: 2 * size,
      limit: 3 * mb,
      needed: mb,
      canReplace: false,
    });
    expect(await usedInDb(me.id)).toEqual({ used: 2 * size, files: 2 * size });
  });

  it("never drops a slot's only version without being told to", async () => {
    const me = await h.user("utku@example.com");
    const first = await upload(me, randomBytes(2 * mb));
    const next = randomBytes(2 * mb);
    const refused = await upload(me, next);
    expect(refused.status).toBe(413);
    expect(refused.body).toMatchObject({ code: "quota_exceeded", canReplace: true, latest: { version: 1 } });
    const replaced = await upload(me, next, { replaceLatest: true });
    expect(replaced.status).toBe(201);
    expect(replaced.body.dropped).toEqual([
      { id: first.body.version.id, version: 1, size: 2 * mb, reason: "replaced" },
    ]);
    expect(replaced.body.save.versions.map((v: { version: number }) => v.version)).toEqual([2]);
    expect(await usedInDb(me.id)).toEqual({ used: 2 * mb, files: 2 * mb });
  });

  it("is checked again when the upload completes", async () => {
    const me = await h.user("utku@example.com");
    const big = randomBytes(2 * mb);
    const begun = await init(me, big, { slot: "one" });
    expect(begun.status).toBe(201);
    await part(me, begun.body.uploadId, 1, big);
    // Meanwhile another slot filled the room.
    expect((await upload(me, randomBytes(2 * mb), { slot: "two" })).status).toBe(201);
    const late = await complete(me, begun.body.uploadId);
    expect(late.status).toBe(413);
    expect(late.body).toMatchObject({ code: "quota_exceeded", used: 2 * mb, limit: 3 * mb, needed: 2 * mb });
  });
});

describe("cleanup", () => {
  beforeEach(() => start());

  it("drops unfinished uploads after a day, stray files and the files of deleted accounts", async () => {
    const me = await h.user("utku@example.com");
    const kept = await upload(me, randomBytes(1000));
    const begun = await init(me, randomBytes(1000), { slot: "half" });
    expect(existsSync(join(dir, ".staging", `${begun.body.uploadId}.upload`))).toBe(true);
    // A file in the store with no row (an upload that failed half way), an hour old.
    const stray = "f".repeat(64);
    await mkdir(join(dir, me.id, "ff"), { recursive: true });
    await writeFile(join(dir, me.id, "ff", stray), "lost");
    const old = new Date(Date.now() - 2 * 3600_000);
    await utimes(join(dir, me.id, "ff", stray), old, old);
    // A folder left by an account that no longer exists.
    const ghost = "00000000-0000-7000-8000-000000000001";
    await mkdir(join(dir, ghost, "aa"), { recursive: true });
    await writeFile(join(dir, ghost, "aa", "a".repeat(64)), "x");

    clock = Date.now() + 25 * 3600_000;
    const swept = await h.deps.files?.sweep();
    expect(swept).toMatchObject({ uploads: 1, objects: 1, accounts: 1 });
    expect(existsSync(join(dir, ".staging", `${begun.body.uploadId}.upload`))).toBe(false);
    expect(existsSync(join(dir, ghost))).toBe(false);
    expect(await objectsOf(me.id)).toEqual([kept.body.version.sha256]);
    // What is in use stays.
    const again = await h.deps.files?.sweep();
    expect(again).toMatchObject({ uploads: 0, objects: 0, accounts: 0, files: 0 });
  });

  it("deletes everything when the account is purged, and lists it in the data export first", async () => {
    const me = await h.user("utku@example.com");
    const done = await upload(me, randomBytes(1000));
    const exported = await h.send("GET", `${v1}/me/export`, { token: me.token });
    const data = await exported.json();
    expect(data.storage.usage.used).toBe(1000);
    expect(data.storage.saves[0].versions[0]).toMatchObject({ version: 1, sha256: done.body.version.sha256 });
    // Its links last a week.
    const link = new URL(data.storage.saves[0].versions[0].download);
    expect(Number(link.searchParams.get("e")) * 1000 - clock).toBeGreaterThan(6 * 24 * 3600_000);
    expect((await h.send("GET", link.pathname + link.search)).status).toBe(200);

    const { purgeDeletedAccounts } = await import("../src/account.js");
    await h.deps.db.execute(
      sql`update accounts set status = 'deleting', delete_after = now() - interval '1 day' where id = ${me.id}`,
    );
    expect(await purgeDeletedAccounts({ db: h.deps.db, valkey: h.valkey, files: h.deps.files })).toBe(1);
    expect(existsSync(join(dir, me.id))).toBe(false);
    const [left] = await h.deps.db.execute<{ n: number }>(sql`select count(*)::int n from stored_files`);
    expect(left?.n).toBe(0);
  });
});
