import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";

/** A picture: the left half red, the right half blue, unless told otherwise. */
const picture = (width: number, height: number, format: "png" | "jpeg" = "png") =>
  sharp({ create: { width, height, channels: 3, background: "#ff0000" } })
    .composite([
      {
        input: { create: { width: Math.ceil(width / 2), height, channels: 3, background: "#0000ff" } },
        left: Math.floor(width / 2),
        top: 0,
      },
    ])
    [format]()
    .toBuffer();

async function upload(token: string, bytes: Uint8Array, query = "", type = "image/png") {
  const response = await h.app.request(`${v1}/me/avatar${query}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": type },
    body: new Uint8Array(bytes),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function fetchAvatar(url: string, headers: Record<string, string> = {}) {
  const response = await h.app.request(new URL(url).pathname, { headers });
  return { response, bytes: Buffer.from(await response.arrayBuffer()) };
}

describe("avatars", () => {
  it("makes a 256 px JPEG without metadata, served by hash to anyone with long caching", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const withGps = await sharp(await picture(600, 400, "jpeg"))
      .withExif({ IFD0: { Copyright: "secret", Artist: "Utku" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();
    const done = await upload(utku.token, withGps, "", "image/jpeg");
    expect(done.status).toBe(200);
    expect(done.body.avatar).toMatch(/^https:\/\/anytogether\.test\/api\/v1\/avatars\/[0-9a-f]{32}\.jpg$/);

    const { response, bytes } = await fetchAvatar(done.body.avatar);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");
    const meta = await sharp(bytes).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 256, height: 256 });
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    const etag = response.headers.get("etag") ?? "";
    expect((await fetchAvatar(done.body.avatar, { "if-none-match": etag })).response.status).toBe(304);

    const me = await h.call("GET", `${v1}/me`, undefined, utku.token);
    expect(me.body.profile.avatar).toBe(done.body.avatar);
  });

  it("crops the square asked for, or the middle one", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const source = await picture(400, 200);
    const left = await upload(utku.token, source, "?left=0&top=0&size=200");
    const leftPixel = await sharp((await fetchAvatar(left.body.avatar)).bytes)
      .extract({ left: 128, top: 128, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(leftPixel[0]).toBeGreaterThan(200);
    expect(leftPixel[2]).toBeLessThan(60);
    const right = await upload(utku.token, source, "?left=200&top=0&size=200");
    const rightPixel = await sharp((await fetchAvatar(right.body.avatar)).bytes)
      .extract({ left: 128, top: 128, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(rightPixel[2]).toBeGreaterThan(200);
    // The earlier picture is gone once replaced.
    expect((await fetchAvatar(left.body.avatar)).response.status).toBe(404);
    expect((await upload(utku.token, source, "?left=300&top=0&size=200")).status).toBe(400);
    expect((await upload(utku.token, source)).status).toBe(200);
  });

  it("turns a sideways phone photo upright", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    // Stored 300×100 but tagged "rotate 90°": upright it is 100×300, so a crop 300 high fits.
    const sideways = await sharp(await picture(300, 100, "jpeg"))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await upload(utku.token, sideways, "?left=0&top=200&size=100", "image/jpeg")).status).toBe(200);
    expect((await upload(utku.token, sideways, "?left=200&top=0&size=100", "image/jpeg")).status).toBe(400);
  });

  it("refuses other formats, big files, tiny and enormous pictures", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const gif = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary");
    const refused = await upload(utku.token, gif, "", "image/png");
    expect(refused.status).toBe(415);
    expect(refused.body.code).toBe("unsupported_media_type");
    const huge = new Uint8Array(5 * 1024 * 1024 + 1);
    huge.set([0x89, 0x50, 0x4e, 0x47]);
    expect((await upload(utku.token, huge)).status).toBe(413);
    expect((await upload(utku.token, await picture(16, 16))).body.code).toBe("bad_image");
    // 6000 × 6000 of one colour compresses to kilobytes but is 36 megapixels.
    const bomb = await sharp({ create: { width: 6_000, height: 6_000, channels: 3, background: "#000" } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    expect((await upload(utku.token, bomb)).body.code).toBe("bad_image");
    const broken = Buffer.concat([(await picture(64, 64)).subarray(0, 60)]);
    expect((await upload(utku.token, broken)).body.code).toBe("bad_image");
    expect((await upload("nope", await picture(64, 64))).status).toBe(401);
  });

  it("limits uploads per account and removes the avatar", async () => {
    h = await harness({ limits: { avatar: { max: 2, seconds: 3600 } } });
    const utku = await h.user("utku@example.com");
    const source = await picture(64, 64);
    expect((await upload(utku.token, source)).status).toBe(200);
    expect((await upload(utku.token, source)).status).toBe(200);
    const third = await upload(utku.token, source);
    expect(third.status).toBe(429);
    expect(third.body.code).toBe("rate_limited");
    expect((await h.call("DELETE", `${v1}/me/avatar`, undefined, utku.token)).status).toBe(204);
    expect((await h.call("GET", `${v1}/me`, undefined, utku.token)).body.profile.avatar).toBeNull();
  });
});
