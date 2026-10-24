import { createHash } from "node:crypto";
import { accounts, themes } from "@anytogether/db";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { postgresStore } from "../src/storage.js";
import { stripId3 } from "../src/themeFile.js";
import { sweepThemeFiles } from "../src/themes.js";
import { extract, readEntries, writeZip } from "../src/zip.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";

/** A theme file as the launcher makes it with ditto: theme.json, a preview, and the AppleDouble
 *  files macOS adds, packed with data descriptors. */
const dittoTheme = Buffer.from(
  "UEsDBBQACAAIAGuqWF0AAAAAAAAAAAAAAAALABAAcHJldmlldy5wbmdVWAwAqvbcaqr23Gr1AQAA6wzwc+flkuJiYGDg9fRwCWJgYHQAsrdwMAHJrLYkNyDFWeARWczAwPwChBm3VgdlMzCw7PR0cQypmPP26kFeZkYepoOrFVpzta//t7d90qzU78J4jenZy89CTBxf5rtWPBMXYOJYcsCpweH7twNM720VWIISFB0WVN+/MMoZnByRCA6BCn47Ju493xsEPBpbGRrf1TqPckY5Q5zz4rpEDWM1Ry4bm2tkBLBkY/B09XNZ55TQBABQSwcIgeFQALYAAAAHBQAAUEsDBBQACAAIAGuqWF0AAAAAAAAAAAAAAAANABAALl9wcmV2aWV3LnBuZ1VYDACq9txqqvbcavUBAABjYBVjZ2BiYPBNTFbwD1aIUIACkBgDJxAbAXEhEIP4ixmIAo4hIUFQJkjHDCDmRlPCiBAXTc7P1UssKMhJ1Ssoyi9LzUvMS05lYGRi2DiHWej6d6tHAFBLBwg0MUhoVgAAAKMAAABQSwMEFAAIAAgAa6pYXQAAAAAAAAAAAAAAAAoAEAB0aGVtZS5qc29uVVgMAKr23Gqq9txq9QEAAD3NQQ6CMBAF0D2naOpWTGuQEHcY6JKNJ6h0hCa0JaVijPHuSqdxN32/8+edEUJl34MNlJwJ3QlRiKai++iPMDof/eoMOAvoN6+H8f//1DYXdAUwo7KaMV6gahWtvPP+KCvIlQ7B5Uaq1Ga0UhPgXlGztkxtVhrU7neZdNvJBZPZw6rhGcM0H2Y7YLiEF7ax+FzBL9rZDXj2yb5QSwcIV92nm5oAAADwAAAAUEsDBBQACAAIAGuqWF0AAAAAAAAAAAAAAAAMABAALl90aGVtZS5qc29uVVgMAKr23Gqq9txq9QEAAGNgFWNnYGJg8E1MVvAPVohQgAKQGAMnEBsBcT4Qg/gLGYgCjiEhQVAmSMccIGZFU8KIEJdIzs/VSywoyEnVy00tSUxJLEm0KkktLmFgyEjNyckHAFBLBwjIB4SKVAAAAKEAAABQSwECFQMUAAgACABrqlhdgeFQALYAAAAHBQAACwAMAAAAAAAAAABApIEAAAAAcHJldmlldy5wbmdVWAgAqvbcaqr23GpQSwECFQMUAAgACABrqlhdNDFIaFYAAACjAAAADQAMAAAAAAAAAABApIH/AAAALl9wcmV2aWV3LnBuZ1VYCACq9txqqvbcalBLAQIVAxQACAAIAGuqWF1X3aebmgAAAPAAAAAKAAwAAAAAAAAAAECkgaABAAB0aGVtZS5qc29uVVgIAKr23Gqq9txqUEsBAhUDFAAIAAgAa6pYXcgHhIpUAAAAoQAAAAwADAAAAAAAAAAAQKSBggIAAC5fdGhlbWUuanNvblVYCACq9txqqvbcalBLBQYAAAAABAAEABYBAAAgAwAAAAA=",
  "base64",
);

const design = (more: Record<string, unknown> = {}) => ({
  id: "neon-nights",
  name: "Neon Nights",
  author: "AnyPS5",
  version: 1,
  style: 0,
  deep: "#0A0014",
  middle: "#4A0E6B",
  bright: "#FF5EDB",
  accent: "#ff4fd8",
  ...more,
});

/** A theme file: theme.json and the files given. */
const themeZip = (
  json: Record<string, unknown>,
  files: { name: string; bytes: Uint8Array }[] = [],
  folder = "",
) =>
  writeZip([
    { name: `${folder}theme.json`, bytes: new TextEncoder().encode(JSON.stringify(json)), deflate: true },
    ...files.map((f) => ({ ...f, name: `${folder}${f.name}`, deflate: true })),
  ]);

const picture = (width = 640, height = 360, color = "#4A0E6B") =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();

/** Changes the size a zip's central directory claims for one entry. */
function claimSize(zip: Uint8Array, name: string, size: number) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let at = 0; at < zip.length - 46; at++) {
    if (view.getUint32(at, true) !== 0x02014b50) continue;
    const length = view.getUint16(at + 28, true);
    if (Buffer.from(zip.subarray(at + 46, at + 46 + length)).toString() === name)
      view.setUint32(at + 24, size, true);
  }
  return zip;
}

async function upload(
  token: string | undefined,
  parts: { theme?: Uint8Array; preview?: Uint8Array; name?: string; description?: string },
  path = `${v1}/themes`,
) {
  const form = new FormData();
  if (parts.theme) form.set("theme", new File([new Uint8Array(parts.theme)], "my.anyps5theme"));
  if (parts.preview) form.set("preview", new File([new Uint8Array(parts.preview)], "preview.png"));
  if (parts.name) form.set("name", parts.name);
  if (parts.description !== undefined) form.set("description", parts.description);
  const response = await h.app.request(path, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function fetchBytes(url: string, headers: Record<string, string> = {}) {
  const u = new URL(url, "https://anytogether.test");
  const response = await h.app.request(`${u.pathname}${u.search}`, { headers });
  return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
}

const unzip = (bytes: Uint8Array) =>
  Object.fromEntries(readEntries(bytes, 64).map((entry) => [entry.name, extract(bytes, entry)]));

describe("theme hub", () => {
  it("shares a theme, lists it, and hands out a repacked file with the Hub's id, maker and version", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const shared = await upload(utku.token, {
      theme: themeZip(design()),
      preview: await picture(1600, 1000),
      description: "Pink and purple, for late nights.",
    });
    expect(shared.status).toBe(201);
    const theme = shared.body;
    expect(theme).toMatchObject({
      name: "Neon Nights",
      version: 1,
      style: 0,
      colors: { deep: "#0A0014", middle: "#4A0E6B", bright: "#FF5EDB", accent: "#FF4FD8" },
      background: null,
      music: false,
      downloads: 0,
      likes: 0,
      description: "Pink and purple, for late nights.",
      status: "published",
      mine: true,
      liked: false,
      maker: { userId: utku.id, handle: utku.handle },
    });
    expect(theme.open).toBe(`anyps5://theme/${theme.id}`);
    expect(theme.download).toBe(`https://anytogether.test/api/v1/themes/${theme.id}/download`);

    // Anyone, signed in or not, sees it.
    const list = await h.call("GET", `${v1}/themes`);
    expect(list.status).toBe(200);
    expect(list.body.themes.map((t: { id: string }) => t.id)).toEqual([theme.id]);
    expect(list.body.next).toBeNull();
    const anonymous = await h.call("GET", `${v1}/themes/${theme.id}`);
    expect(anonymous.body).toMatchObject({ mine: false, liked: false });

    const preview = await fetchBytes(theme.preview);
    expect(preview.response.headers.get("content-type")).toBe("image/webp");
    expect(preview.response.headers.get("cache-control")).toContain("immutable");
    expect(await sharp(preview.bytes).metadata()).toMatchObject({ format: "webp", width: 1280, height: 720 });
    const thumb = await fetchBytes(theme.thumb);
    expect(await sharp(thumb.bytes).metadata()).toMatchObject({ width: 640, height: 360 });

    const file = await fetchBytes(theme.download);
    expect(file.response.status).toBe(200);
    expect(file.response.headers.get("content-disposition")).toBe(
      'attachment; filename="neon-nights.anyps5theme"',
    );
    expect(createHash("sha256").update(file.bytes).digest("hex")).toBe(theme.sha256);
    const inside = unzip(file.bytes);
    expect(Object.keys(inside)).toEqual(["theme.json"]);
    const json = JSON.parse(Buffer.from(inside["theme.json"] as Uint8Array).toString());
    expect(json).toMatchObject({
      id: theme.id,
      author: "utku",
      version: 1,
      accent: "#FF4FD8",
      name: "Neon Nights",
    });
  });

  it("takes the file macOS makes, with its folder or AppleDouble files, as a raw body with the still inside", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const raw = await h.app.request(`${v1}/themes`, {
      method: "POST",
      headers: { authorization: `Bearer ${utku.token}`, "content-type": "application/zip" },
      body: new Uint8Array(dittoTheme),
    });
    expect(raw.status).toBe(201);
    expect(await raw.json()).toMatchObject({ name: "Neon Nights", colors: { accent: "#FF4FD8" } });

    const inFolder = await upload(utku.token, {
      theme: themeZip(
        design({ id: "other", preview: "still.png" }),
        [{ name: "still.png", bytes: await picture() }],
        "Mine/",
      ),
    });
    expect(inFolder.status).toBe(201);
  });

  it("needs a still, and makes one from a background picture, which loses its metadata", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const none = await upload(utku.token, { theme: themeZip(design()) });
    expect(none.status).toBe(400);
    expect(none.body.code).toBe("preview_required");

    const photo = await sharp(await picture(800, 600, "#FF5EDB"))
      .withExif({ IFD0: { Artist: "Utku", Copyright: "secret" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeDefined();
    const withPicture = await upload(utku.token, {
      theme: themeZip(design({ background: "my photo.JPG" }), [{ name: "my photo.JPG", bytes: photo }]),
    });
    expect(withPicture.status).toBe(201);
    expect(withPicture.body.background).toBe("picture");
    const inside = unzip((await fetchBytes(withPicture.body.download)).bytes);
    expect(Object.keys(inside).sort()).toEqual(["background.jpg", "theme.json"]);
    const meta = await sharp(inside["background.jpg"]).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 800, height: 600 });
    expect(meta.exif).toBeUndefined();
    expect(JSON.parse(Buffer.from(inside["theme.json"] as Uint8Array).toString()).background).toBe(
      "background.jpg",
    );
  });

  it("keeps music and videos that are what they say, and strips an MP3's tags", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const tag = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]);
    const frames = new Uint8Array([0xff, 0xfb, 0x90, 0x64, ...new Array(200).fill(7)]);
    const mp3 = new Uint8Array([...tag, ...frames]);
    expect([...stripId3(mp3)]).toEqual([...frames]);
    const mp4 = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypmp42"), ...new Array(300).fill(1)]);
    const ok = await upload(utku.token, {
      theme: themeZip(design({ background: "clip.mp4", music: "song.mp3" }), [
        { name: "clip.mp4", bytes: mp4 },
        { name: "song.mp3", bytes: mp3 },
      ]),
      preview: await picture(),
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ background: "video", music: true });
    const inside = unzip((await fetchBytes(ok.body.download)).bytes);
    expect([...(inside["music.mp3"] as Uint8Array)]).toEqual([...frames]);
    expect(inside["background.mp4"]?.length).toBe(mp4.length);

    const fake = await upload(utku.token, {
      theme: themeZip(design({ id: "x", background: "clip.mp4" }), [
        { name: "clip.mp4", bytes: await picture() },
      ]),
      preview: await picture(),
    });
    expect(fake.status).toBe(400);
    expect(fake.body.code).toBe("bad_theme");
  });

  it("refuses what is not a theme, what lies about its sizes, and what is too big", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const preview = await picture();
    const refused = async (theme: Uint8Array, status = 400) => {
      const answer = await upload(utku.token, { theme, preview });
      expect(answer.status, JSON.stringify(answer.body)).toBe(status);
      return answer.body;
    };
    expect((await refused(new TextEncoder().encode("not a zip"))).code).toBe("bad_theme");
    expect((await refused(writeZip([{ name: "readme.txt", bytes: new Uint8Array(3) }]))).title).toContain(
      "needs one theme.json",
    );
    expect((await refused(themeZip(design({ accent: "pink" })))).title).toContain("accent");
    expect((await refused(themeZip(design({ background: "gone.png" })))).title).toContain("gone.png");
    expect((await refused(themeZip(design({ background: "../../etc/passwd" })))).code).toBe("bad_theme");
    expect(
      (
        await refused(
          themeZip(design({ background: "evil.svg" }), [{ name: "evil.svg", bytes: new Uint8Array(10) }]),
        )
      ).code,
    ).toBe("bad_theme");
    // Two theme.json files, or too many files.
    expect(
      (
        await refused(
          writeZip([
            { name: "theme.json", bytes: new Uint8Array(2) },
            { name: "a/theme.json", bytes: new Uint8Array(2) },
          ]),
        )
      ).code,
    ).toBe("bad_theme");
    const many = Array.from({ length: 70 }, (_, i) => ({ name: `f${i}`, bytes: new Uint8Array(1) }));
    expect((await refused(themeZip(design(), many))).title).toContain("at most 64 files");

    // A bomb: megabytes of zeros that claim to be a few bytes are stopped while unpacking.
    const zeros = new Uint8Array(8 * 1024 * 1024);
    const bomb = claimSize(
      themeZip(design({ background: "b.png" }), [{ name: "b.png", bytes: zeros }]),
      "b.png",
      1000,
    );
    expect(bomb.length).toBeLessThan(100_000);
    expect((await refused(bomb)).code).toBe("bad_theme");
    // One that admits its size is refused before anything is unpacked.
    const big = claimSize(
      themeZip(design({ background: "b.png" }), [{ name: "b.png", bytes: zeros }]),
      "b.png",
      16 * 1024 * 1024,
    );
    expect((await refused(big, 413)).code).toBe("payload_too_large");
    // A damaged entry fails its CRC.
    const damaged = themeZip(design());
    damaged[40] = (damaged[40] ?? 0) ^ 0xff;
    expect((await refused(damaged)).code).toBe("bad_theme");

    const signedOut = await upload(undefined, { theme: themeZip(design()), preview });
    expect(signedOut.status).toBe(401);
  });

  it("takes a theme bigger than the API's usual 8 MB body limit, which still holds elsewhere", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const noise = new Uint8Array(9 * 1024 * 1024);
    for (let i = 0; i < noise.length; i += 65_536) crypto.getRandomValues(noise.subarray(i, i + 65_536));
    const video = new Uint8Array([
      0,
      0,
      0,
      24,
      ...Buffer.from("ftypmp42"),
      ...noise.subarray(0, noise.length - 12),
    ]);
    const theme = themeZip(design({ background: "big.mp4" }), [{ name: "big.mp4", bytes: video }]);
    expect(theme.length).toBeGreaterThan(8 * 1024 * 1024);
    const big = await upload(utku.token, { theme, preview: await picture() });
    expect(big.status, JSON.stringify(big.body)).toBe(201);
    expect(big.body.size).toBeGreaterThan(8 * 1024 * 1024);
    const elsewhere = await h.app.request(`${v1}/reports`, {
      method: "POST",
      headers: { authorization: `Bearer ${utku.token}`, "content-type": "application/json" },
      body: JSON.stringify({ note: "x".repeat(9 * 1024 * 1024) }),
    });
    expect(elsewhere.status).toBe(413);
  });

  it("knows the maker's next upload of a theme as a new version, and drops the old files", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const preview = await picture();
    const first = await upload(utku.token, { theme: themeZip(design()), preview });
    const again = await upload(utku.token, { theme: themeZip(design()), preview });
    expect(again.status).toBe(409);
    expect(again.body.themeId).toBe(first.body.id);

    const ayse = await h.user("ayse@example.com");
    const notTheirs = await upload(
      ayse.token,
      { theme: themeZip(design()), preview },
      `${v1}/themes/${first.body.id}/versions`,
    );
    expect(notTheirs.status).toBe(403);
    // Someone else may share a theme with the same id inside: it is their own.
    expect((await upload(ayse.token, { theme: themeZip(design()), preview })).status).toBe(201);

    const second = await upload(
      utku.token,
      { theme: themeZip(design({ accent: "#00FF00", name: "Neon Nights II" })), preview },
      `${v1}/themes/${first.body.id}/versions`,
    );
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      id: first.body.id,
      version: 2,
      name: "Neon Nights II",
      colors: { accent: "#00FF00" },
    });
    const json = JSON.parse(
      Buffer.from(
        unzip((await fetchBytes(second.body.download)).bytes)["theme.json"] as Uint8Array,
      ).toString(),
    );
    expect(json).toMatchObject({ id: first.body.id, version: 2 });
    const keys = await postgresStore(h.deps.db).list(`themes/${first.body.id}/`);
    expect(keys.every((key) => key.includes("/v2/"))).toBe(true);
    expect(keys).toHaveLength(3);
    // An old still's address is not cached for ever.
    const old = await fetchBytes(first.body.thumb);
    expect(old.response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("counts downloads once a day per person, not the maker's, and likes once per person", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const preview = await picture();
    const a = (await upload(utku.token, { theme: themeZip(design({ id: "a", name: "Alpha" })), preview }))
      .body;
    const b = (await upload(utku.token, { theme: themeZip(design({ id: "b", name: "Beta" })), preview }))
      .body;

    await fetchBytes(a.download, { authorization: `Bearer ${utku.token}` });
    await fetchBytes(a.download, { authorization: `Bearer ${ayse.token}` });
    await fetchBytes(a.download, { authorization: `Bearer ${ayse.token}` });
    await fetchBytes(a.download, { "x-real-ip": "203.0.113.9" });
    expect((await h.call("GET", `${v1}/themes/${a.id}`)).body.downloads).toBe(2);

    expect((await h.call("PUT", `${v1}/themes/${b.id}/like`, undefined, ayse.token)).body).toEqual({
      liked: true,
      likes: 1,
    });
    expect((await h.call("POST", `${v1}/themes/${b.id}/like`, undefined, ayse.token)).body).toEqual({
      liked: true,
      likes: 1,
    });
    expect((await h.call("PUT", `${v1}/themes/${b.id}/like`, undefined, utku.token)).status).toBe(400);
    expect((await h.call("GET", `${v1}/themes/${b.id}`, undefined, ayse.token)).body.liked).toBe(true);
    expect((await h.call("PUT", `${v1}/themes/${b.id}/like`)).status).toBe(401);

    const order = async (sort: string) =>
      (await h.call("GET", `${v1}/themes?sort=${sort}`)).body.themes.map((t: { name: string }) => t.name);
    expect(await order("new")).toEqual(["Beta", "Alpha"]);
    expect(await order("popular")).toEqual(["Alpha", "Beta"]);
    expect(await order("liked")).toEqual(["Beta", "Alpha"]);
    expect((await h.call("GET", `${v1}/themes?sort=worst`)).status).toBe(400);

    expect((await h.call("DELETE", `${v1}/themes/${b.id}/like`, undefined, ayse.token)).body).toEqual({
      liked: false,
      likes: 0,
    });
    expect((await h.call("DELETE", `${v1}/themes/${b.id}/like`, undefined, ayse.token)).body).toEqual({
      liked: false,
      likes: 0,
    });

    // Search by name or maker, by author, and page through.
    const names = async (query: string) =>
      (await h.call("GET", `${v1}/themes?${query}`)).body.themes.map((t: { name: string }) => t.name);
    expect(await names("q=alp")).toEqual(["Alpha"]);
    expect(await names("q=utku")).toHaveLength(2);
    expect(await names("q=%25")).toEqual([]);
    expect(await names(`author=@${utku.handle}`)).toHaveLength(2);
    expect(await names(`author=${ayse.handle}`)).toEqual([]);
    const page = await h.call("GET", `${v1}/themes?limit=1`);
    expect(page.body.next).toBe("1");
    expect((await h.call("GET", `${v1}/themes?limit=1&cursor=1`)).body.themes[0].name).toBe("Alpha");

    // The index old launchers read.
    const index = await h.call("GET", `${v1}/hub/themes.json`);
    expect(index.body.themes[0]).toEqual({
      id: a.id,
      name: "Alpha",
      author: "utku",
      version: 1,
      style: 0,
      deep: "#0A0014",
      middle: "#4A0E6B",
      bright: "#FF5EDB",
      accent: "#FF4FD8",
      package: a.download,
      preview: a.thumb,
    });
  });

  it("lets only the maker change the words or delete it; their list shows every state", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const theme = (await upload(utku.token, { theme: themeZip(design()), preview: await picture() })).body;
    const path = `${v1}/themes/${theme.id}`;
    expect((await h.call("PATCH", path, { name: "Nope" }, ayse.token)).status).toBe(403);
    expect((await h.call("PATCH", path, { description: "see example.com" }, utku.token)).status).toBe(400);
    expect((await h.call("PATCH", path, {}, utku.token)).status).toBe(400);
    const changed = await h.call(
      "PATCH",
      path,
      { name: "  Late   Nights ", description: "Purple." },
      utku.token,
    );
    expect(changed.body).toMatchObject({ name: "Late Nights", description: "Purple." });
    const json = JSON.parse(
      Buffer.from(unzip((await fetchBytes(theme.download)).bytes)["theme.json"] as Uint8Array).toString(),
    );
    expect(json.name).toBe("Neon Nights");
    expect((await h.call("GET", `${v1}/me/themes`, undefined, utku.token)).body.themes).toHaveLength(1);

    expect((await h.call("DELETE", path, undefined, ayse.token)).status).toBe(403);
    expect((await h.call("DELETE", path, undefined, utku.token)).status).toBe(204);
    expect((await h.call("GET", path)).status).toBe(404);
    expect((await fetchBytes(theme.download)).response.status).toBe(404);
    expect(await postgresStore(h.deps.db).list(`themes/${theme.id}/`)).toEqual([]);
  });

  it("puts a theme three people reported in review, and a moderator decides", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const theme = (await upload(utku.token, { theme: themeZip(design()), preview: await picture() })).body;
    const report = (token: string) =>
      h.call("POST", `${v1}/reports`, { targetKind: "theme", targetId: theme.id, reason: "sexual" }, token);
    expect((await report(utku.token)).status).toBe(400);
    for (const name of ["a", "b"])
      expect((await report((await h.user(`${name}@example.com`)).token)).status).toBe(201);
    expect((await h.call("GET", `${v1}/themes`)).body.themes).toHaveLength(1);
    expect((await report((await h.user("c@example.com")).token)).status).toBe(201);
    expect((await h.call("GET", `${v1}/themes`)).body.themes).toHaveLength(0);
    expect((await h.call("GET", `${v1}/themes/${theme.id}`)).status).toBe(404);
    expect((await fetchBytes(theme.thumb)).response.status).toBe(404);
    // Its maker still sees it, and why.
    expect((await h.call("GET", `${v1}/me/themes`, undefined, utku.token)).body.themes[0].status).toBe(
      "review",
    );
    expect((await h.call("GET", `${v1}/themes/${theme.id}`, undefined, utku.token)).body.status).toBe(
      "review",
    );

    const ctx = { db: h.deps.db, valkey: h.valkey };
    expect(await run(["reports"], ctx)).toContain("theme: “Neon Nights”");
    expect(await run(["theme", theme.id, "show"], ctx)).toBe("theme “Neon Nights” is published");
    expect((await h.call("GET", `${v1}/themes`)).body.themes).toHaveLength(1);
    expect(await run(["theme", theme.id, "hide"], ctx)).toContain("hidden");
    expect((await h.call("GET", `${v1}/themes`)).body.themes).toHaveLength(0);
    expect((await report((await h.user("d@example.com")).token)).status).toBe(404);
  });

  it("removes the files of themes whose account was deleted", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const theme = (await upload(utku.token, { theme: themeZip(design()), preview: await picture() })).body;
    await h.deps.db.delete(accounts).where(eq(accounts.id, utku.id));
    expect(await h.deps.db.select().from(themes)).toEqual([]);
    expect(await sweepThemeFiles(h.deps)).toBe(1);
    expect(await postgresStore(h.deps.db).list(`themes/${theme.id}/`)).toEqual([]);
  });
});
