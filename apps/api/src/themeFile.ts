import {
  ErrorCode,
  ThemeJson,
  themeLimits,
  themeMusicTypes,
  themePictureTypes,
  themeVideoTypes,
} from "@anytogether/shared";
import sharp from "sharp";
import { HttpError } from "./errors.js";
import { type ZipEntry, ZipError, extract, readEntries, writeZip } from "./zip.js";

/** Reading a .anyps5theme the way the launcher's installer does (theme.json and only the files it
 *  names, by plain names), but stricter: sizes and kinds are checked by their bytes, pictures are
 *  re-encoded without their metadata, and the file people download is packed again by the Hub. */

sharp.cache(false);

const bad = (message: string) => new HttpError(400, ErrorCode.badTheme, message);
const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export interface Media {
  /** The file name inside the theme: background.jpg, music.m4a. */
  name: string;
  bytes: Uint8Array;
}

export interface ThemeContents {
  json: ThemeJson;
  background: (Media & { kind: "picture" | "video" }) | null;
  music: Media | null;
  /** A still of the theme, if the file brought one. */
  preview: Uint8Array | null;
}

const extensionOf = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));
const isMp4 = (b: Uint8Array) => b.length > 12 && ascii(b, 4, 4) === "ftyp";
const isMov = (b: Uint8Array) =>
  isMp4(b) || (b.length > 12 && ["wide", "moov", "mdat", "free"].includes(ascii(b, 4, 4)));

/** Whether the bytes are the kind of sound file the name says. */
function soundMatches(extension: string, b: Uint8Array) {
  switch (extension) {
    case "m4a":
      return isMp4(b);
    case "caf":
      return ascii(b, 0, 4) === "caff";
    case "wav":
      return ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE";
    case "aif":
    case "aiff":
      return ascii(b, 0, 4) === "FORM" && ["AIFF", "AIFC"].includes(ascii(b, 8, 4));
    case "mp3":
      return ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0);
    case "aac":
      return isMp4(b) || (b[0] === 0xff && ((b[1] ?? 0) & 0xf6) === 0xf0);
    default:
      return false;
  }
}

/** An MP3 without its ID3 tags (titles, comments, cover pictures). */
export function stripId3(input: Uint8Array) {
  let start = 0;
  while (input.length - start > 10 && ascii(input, start, 3) === "ID3") {
    const size =
      (((input[start + 6] ?? 0) & 0x7f) << 21) |
      (((input[start + 7] ?? 0) & 0x7f) << 14) |
      (((input[start + 8] ?? 0) & 0x7f) << 7) |
      ((input[start + 9] ?? 0) & 0x7f);
    const footer = (input[start + 5] ?? 0) & 0x10 ? 10 : 0;
    start += 10 + size + footer;
  }
  let end = input.length;
  if (end - start >= 128 && ascii(input, end - 128, 3) === "TAG") end -= 128;
  return input.subarray(Math.min(start, end), end);
}

const pictureFormats = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp" } as const;

/** A background picture re-encoded in its own format, turned upright, with no metadata. */
export async function cleanPicture(bytes: Uint8Array, extension: string) {
  const format = pictureFormats[extension as keyof typeof pictureFormats];
  if (!format) throw bad(`A background picture is ${themePictureTypes.join(", ")}`);
  const open = () => sharp(bytes, { limitInputPixels: themeLimits.pixels, failOn: "error", animated: false });
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await open().metadata();
  } catch {
    throw bad("The background picture could not be read");
  }
  if (meta.format !== format) throw bad("The background picture is not what its name says");
  if ((meta.width ?? 0) < 64 || (meta.height ?? 0) < 64) throw bad("The background picture is too small");
  try {
    const image = open().autoOrient();
    const out =
      format === "jpeg"
        ? image.jpeg({ quality: 92, mozjpeg: true })
        : format === "png"
          ? image.png({ compressionLevel: 9 })
          : image.webp({ quality: 90 });
    return new Uint8Array(await out.toBuffer());
  } catch {
    throw bad("The background picture could not be read");
  }
}

/** The 1280x720 still and the 640x360 one for cards, as WebP without metadata. */
export async function makeStills(input: Uint8Array) {
  const open = () => sharp(input, { limitInputPixels: themeLimits.pixels, failOn: "error", animated: false });
  try {
    const meta = await open().metadata();
    if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format))
      throw new HttpError(415, ErrorCode.unsupportedMedia, "A preview is a PNG, JPEG or WebP picture");
    if ((meta.width ?? 0) < 160 || (meta.height ?? 0) < 90)
      throw new HttpError(400, ErrorCode.badImage, "The preview is too small");
    const [preview, thumb] = await Promise.all([
      open().autoOrient().resize(1280, 720, { fit: "cover" }).webp({ quality: 82 }).toBuffer(),
      open().autoOrient().resize(640, 360, { fit: "cover" }).webp({ quality: 78 }).toBuffer(),
    ]);
    return { preview: new Uint8Array(preview), thumb: new Uint8Array(thumb) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, ErrorCode.badImage, "The preview could not be read");
  }
}

/** Ignored inside a theme file: what macOS adds when it zips a folder. */
const isNoise = (name: string) => {
  const base = name.slice(name.lastIndexOf("/") + 1);
  return name.startsWith("__MACOSX/") || base.startsWith("._") || base === ".DS_Store" || name.endsWith("/");
};

/** What a .anyps5theme holds, checked. */
export async function readTheme(bytes: Uint8Array): Promise<ThemeContents> {
  if (bytes.length > themeLimits.file)
    throw new HttpError(413, ErrorCode.payloadTooLarge, `A theme is at most ${mb(themeLimits.file)}`);
  let entries: ZipEntry[];
  try {
    entries = readEntries(bytes, themeLimits.entries);
  } catch (error) {
    throw bad(
      error instanceof ZipError ? `This is not a theme file: ${error.message}` : "This is not a theme file",
    );
  }
  const real = entries.filter((entry) => !isNoise(entry.name));
  // theme.json at the top, or in the one folder the zip holds.
  const jsons = real.filter((entry) => /^([^/]+\/)?theme\.json$/.test(entry.name));
  if (jsons.length !== 1 || !jsons[0]) throw bad("This is not a theme file: it needs one theme.json");
  const folder = jsons[0].name.slice(0, jsons[0].name.length - "theme.json".length);
  const byName = new Map(
    real.filter((e) => e.name.startsWith(folder)).map((e) => [e.name.slice(folder.length), e]),
  );

  let unpacked = 0;
  const take = (entry: ZipEntry, max: number, what: string) => {
    if (entry.size > max)
      throw new HttpError(413, ErrorCode.payloadTooLarge, `${what} is at most ${mb(max)}`);
    unpacked += entry.size;
    if (unpacked > themeLimits.unpacked) throw bad(`A theme unpacks to at most ${mb(themeLimits.unpacked)}`);
    try {
      return extract(bytes, entry);
    } catch (error) {
      throw bad(error instanceof ZipError ? error.message : "The theme file is damaged");
    }
  };

  const raw = take(jsons[0], themeLimits.json, "theme.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw bad("theme.json is not valid JSON");
  }
  const checked = ThemeJson.safeParse(parsed);
  if (!checked.success)
    throw bad(
      `theme.json: ${checked.error.issues.map((i) => `${i.path.join(".") || "theme"}: ${i.message}`).join("; ")}`,
    );
  const json = checked.data;

  const named = (name: string | null | undefined, what: string) => {
    if (!name) return null;
    const entry = byName.get(name);
    if (!entry) throw bad(`theme.json names ${what} "${name}", which is not in the file`);
    return entry;
  };

  let background: ThemeContents["background"] = null;
  const backgroundEntry = named(json.background, "a background");
  if (backgroundEntry && json.background) {
    const extension = extensionOf(json.background);
    if ((themeVideoTypes as readonly string[]).includes(extension)) {
      const video = take(backgroundEntry, themeLimits.video, "A background video");
      if (!(extension === "mov" ? isMov(video) : isMp4(video)))
        throw bad("The background video is not what its name says");
      background = { kind: "video", name: `background.${extension}`, bytes: video };
    } else if ((themePictureTypes as readonly string[]).includes(extension)) {
      const picture = take(backgroundEntry, themeLimits.picture, "A background picture");
      background = {
        kind: "picture",
        name: `background.${extension}`,
        bytes: await cleanPicture(picture, extension),
      };
    } else {
      throw bad(
        `A background is a picture (${themePictureTypes.join(", ")}) or a video (${themeVideoTypes.join(", ")})`,
      );
    }
  }

  let music: Media | null = null;
  const musicEntry = named(json.music, "music");
  if (musicEntry && json.music) {
    const extension = extensionOf(json.music);
    if (!(themeMusicTypes as readonly string[]).includes(extension))
      throw bad(`Music is ${themeMusicTypes.join(", ")}`);
    const sound = take(musicEntry, themeLimits.music, "Music");
    if (!soundMatches(extension, sound)) throw bad("The music is not what its name says");
    music = { name: `music.${extension}`, bytes: extension === "mp3" ? stripId3(sound) : sound };
  }

  const previewEntry =
    named(json.preview, "a preview") ??
    ["preview.png", "preview.jpg", "preview.jpeg", "preview.webp"].map((n) => byName.get(n)).find(Boolean) ??
    null;
  const preview = previewEntry ? take(previewEntry, themeLimits.preview, "A preview") : null;

  return { json, background, music, preview };
}

/** The file people download: theme.json with the Hub's id, maker and version, and the media. */
export function packTheme(contents: ThemeContents, stamp: { id: string; author: string; version: number }) {
  const { json, background, music } = contents;
  const { preview: _, ...rest } = json;
  const design: Record<string, unknown> = {
    ...rest,
    id: stamp.id,
    author: stamp.author,
    version: stamp.version,
    background: background?.name ?? null,
    music: music?.name ?? null,
  };
  for (const key of Object.keys(design)) if (design[key] === null) delete design[key];
  const files = [
    { name: "theme.json", bytes: new TextEncoder().encode(JSON.stringify(design, null, 2)), deflate: true },
    ...(background ? [{ name: background.name, bytes: background.bytes }] : []),
    ...(music ? [{ name: music.name, bytes: music.bytes }] : []),
  ];
  return { bytes: writeZip(files), design };
}
