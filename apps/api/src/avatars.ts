import { createHash } from "node:crypto";
import { avatars, profiles } from "@anytogether/db";
import { ErrorCode } from "@anytogether/shared";
import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import sharp from "sharp";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { rateLimiter } from "./ratelimit.js";

export const avatarMaxBytes = 5 * 1024 * 1024;
export const avatarSize = 256;
/** A bigger picture is refused before it is decoded (25 megapixels is ~100 MB of pixels). */
const maxPixels = 25_000_000;
const minSide = 32;

sharp.cache(false);

/** PNG or JPEG by their first bytes, whatever the Content-Type says. */
function kindOf(bytes: Uint8Array) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

const badImage = () => new HttpError(400, ErrorCode.badImage, "That picture could not be read");

/** The picture as an avatar: turned upright, the square asked for (or the middle one), 256 px,
 *  re-encoded as JPEG with no metadata (no location, no camera, no comments). */
export async function makeAvatar(input: Uint8Array, crop?: { left: number; top: number; size: number }) {
  if (!kindOf(input))
    throw new HttpError(415, ErrorCode.unsupportedMedia, "An avatar is a PNG or JPEG picture");
  const open = () =>
    sharp(input, { limitInputPixels: maxPixels, failOn: "error", sequentialRead: true, animated: false });
  let width: number;
  let height: number;
  try {
    const meta = await open().metadata();
    if (meta.format !== "png" && meta.format !== "jpeg") throw badImage();
    // Orientations 5-8 swap the sides once the picture is turned upright.
    const turned = (meta.orientation ?? 1) >= 5;
    width = (turned ? meta.height : meta.width) ?? 0;
    height = (turned ? meta.width : meta.height) ?? 0;
    if (width * height > maxPixels) throw badImage();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badImage();
  }
  if (width < minSide || height < minSide)
    throw new HttpError(400, ErrorCode.badImage, `An avatar is at least ${minSide} px on each side`);
  const side = Math.min(width, height);
  const square = crop ?? {
    left: Math.floor((width - side) / 2),
    top: Math.floor((height - side) / 2),
    size: side,
  };
  if (
    square.size < minSide ||
    square.left < 0 ||
    square.top < 0 ||
    square.left + square.size > width ||
    square.top + square.size > height
  )
    throw new HttpError(400, ErrorCode.badRequest, "The crop is outside the picture");
  try {
    return await open()
      .autoOrient()
      .extract({ left: square.left, top: square.top, width: square.size, height: square.size })
      .resize(avatarSize, avatarSize, { fit: "fill" })
      .flatten({ background: "#0c0e14" })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
  } catch {
    throw badImage();
  }
}

const cropParam = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new HttpError(400, ErrorCode.badRequest, "The crop is whole pixels");
  return parsed;
};

/** Avatars: PUT a picture (the body itself), DELETE it, and GET them by hash for anyone. */
export function avatarRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const limit = rateLimiter(deps.valkey, deps.limits);
  const urlOf = (hash: string) => new URL(`/api/v1/avatars/${hash}.jpg`, deps.publicUrl).toString();

  app.get("/avatars/:file{[0-9a-f]{32}\\.jpg}", async (c) => {
    const hash = c.req.param("file").slice(0, 32);
    const etag = `"${hash}"`;
    const cache = { "cache-control": "public, max-age=31536000, immutable", etag };
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, cache);
    const [row] = await deps.db.select({ bytes: avatars.bytes }).from(avatars).where(eq(avatars.hash, hash));
    if (!row) throw new HttpError(404, ErrorCode.notFound, "No such avatar");
    return c.body(new Uint8Array(row.bytes), 200, {
      ...cache,
      "content-type": "image/jpeg",
      "x-content-type-options": "nosniff",
    });
  });

  app.put(
    "/me/avatar",
    requireUser(deps),
    bodyLimit({
      maxSize: avatarMaxBytes,
      onError: () => {
        throw new HttpError(413, ErrorCode.payloadTooLarge, "An avatar is at most 5 MB");
      },
    }),
    async (c) => {
      const me = c.get("userId");
      await limit("avatar", me);
      const left = cropParam(c.req.query("left"));
      const top = cropParam(c.req.query("top"));
      const size = cropParam(c.req.query("size"));
      const crop =
        left !== undefined && top !== undefined && size !== undefined ? { left, top, size } : undefined;
      const picture = await makeAvatar(new Uint8Array(await c.req.arrayBuffer()), crop);
      // The account is part of the hash, so two people with the same picture never share a row.
      const hash = createHash("sha256").update(me).update(picture).digest("hex").slice(0, 32);
      await deps.db.transaction(async (tx) => {
        await tx.insert(avatars).values({ hash, accountId: me, bytes: picture }).onConflictDoNothing();
        await tx
          .update(profiles)
          .set({ avatarUrl: urlOf(hash) })
          .where(eq(profiles.accountId, me));
        await tx.delete(avatars).where(and(eq(avatars.accountId, me), ne(avatars.hash, hash)));
      });
      return c.json({ avatar: urlOf(hash) });
    },
  );

  app.delete("/me/avatar", requireUser(deps), async (c) => {
    const me = c.get("userId");
    await deps.db.transaction(async (tx) => {
      await tx.update(profiles).set({ avatarUrl: null }).where(eq(profiles.accountId, me));
      await tx.delete(avatars).where(eq(avatars.accountId, me));
    });
    return c.body(null, 204);
  });

  return app;
}
