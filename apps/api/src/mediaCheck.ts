import { open } from "node:fs/promises";

/** Reads just enough of a clip or voice note to know it is what it says: the container's boxes or
 *  elements, the codecs of its tracks and how long it lasts. Nothing is decoded or transcoded. */

export type Sniffed = "png" | "jpeg" | "webp" | "mp4" | "ogg" | "webm";

/** The kind of file by its first bytes, whatever the Content-Type says. */
export function sniff(head: Uint8Array): Sniffed | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  const ascii = (i: number, text: string) => at(i, ...[...text].map((c) => c.charCodeAt(0)));
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  if (ascii(4, "ftyp")) return "mp4";
  if (ascii(0, "OggS")) return "ogg";
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "webm";
  return null;
}

export class BadMedia extends Error {}
const bad = (why: string) => new BadMedia(why);

export interface Mp4Info {
  brand: string;
  /** The first video track's sample entry (avc1, avc3, hvc1…) and the first audio track's (mp4a…). */
  video: string | null;
  audio: string | null;
  durationMs: number;
  width: number | null;
  height: number | null;
}

const containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"]);

/** Walks the boxes in `buf` (from `start` to `end`), calling `visit` with each one's type and the
 *  bounds of its contents. */
function boxes(
  buf: Buffer,
  start: number,
  end: number,
  visit: (type: string, from: number, to: number) => void,
) {
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) throw bad("a box is cut short");
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) throw bad(`the ${type} box does not fit`);
    visit(type, at + header, at + size);
    at += size;
  }
}

/** The moov box of an MP4 read: its tracks' codecs, the length and the picture's size. */
export function readMoov(moov: Buffer, brand: string): Mp4Info {
  const info: Mp4Info = { brand, video: null, audio: null, durationMs: 0, width: null, height: null };
  const walk = (from: number, to: number, track: { handler?: string; width?: number; height?: number }) =>
    boxes(moov, from, to, (type, a, b) => {
      if (type === "trak") {
        const inner: { handler?: string; width?: number; height?: number } = {};
        walk(a, b, inner);
        if (inner.handler === "vide" && inner.width && !info.width) {
          info.width = inner.width;
          info.height = inner.height ?? null;
        }
        return;
      }
      if (containers.has(type)) return walk(a, b, track);
      if (type === "mvhd" && b - a >= 20) {
        const v1 = moov[a] === 1;
        const scale = moov.readUInt32BE(a + (v1 ? 20 : 12));
        const length = v1 ? Number(moov.readBigUInt64BE(a + 24)) : moov.readUInt32BE(a + 16);
        if (scale > 0) info.durationMs = Math.round((length / scale) * 1000);
      }
      if (type === "tkhd") {
        const off = moov[a] === 1 ? 88 : 76;
        if (b - a >= off + 8) {
          track.width = moov.readUInt32BE(a + off) >>> 16;
          track.height = moov.readUInt32BE(a + off + 4) >>> 16;
        }
      }
      if (type === "hdlr" && b - a >= 12) track.handler = moov.toString("latin1", a + 8, a + 12);
      if (type === "stsd" && b - a >= 16) {
        const entry = moov.toString("latin1", a + 12, a + 16);
        if (track.handler === "vide" && !info.video) info.video = entry;
        if (track.handler === "soun" && !info.audio) info.audio = entry;
      }
    });
  walk(0, moov.length, {});
  return info;
}

/** Checks an MP4 file's top-level boxes (ftyp first, a moov and media data) and reads its moov. */
export async function readMp4(path: string): Promise<Mp4Info> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const head = Buffer.alloc(16);
    let at = 0;
    let brand = "";
    let moov: Buffer | null = null;
    let hasData = false;
    let first = true;
    while (at + 8 <= size) {
      await file.read(head, 0, 16, at);
      let boxSize = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      let header = 8;
      if (boxSize === 1) {
        boxSize = Number(head.readBigUInt64BE(8));
        header = 16;
      } else if (boxSize === 0) boxSize = size - at;
      if (boxSize < header || at + boxSize > size) throw bad(`the ${type} box does not fit in the file`);
      if (first && type !== "ftyp") throw bad("an MP4 starts with its ftyp box");
      first = false;
      if (type === "ftyp") brand = head.toString("latin1", header, header + 4);
      if (type === "moov") {
        if (moov) throw bad("two moov boxes");
        if (boxSize > 16 * 1024 * 1024) throw bad("the moov box is too big");
        moov = Buffer.alloc(boxSize - header);
        await file.read(moov, 0, moov.length, at + header);
      }
      if (type === "mdat" && boxSize > header) hasData = true;
      at += boxSize;
    }
    if (!moov) throw bad("no moov box");
    if (!hasData) throw bad("no media data");
    return readMoov(moov, brand);
  } finally {
    await file.close();
  }
}

export interface AudioInfo {
  container: "ogg" | "webm" | "mp4";
  codec: "opus" | "aac";
  durationMs: number;
  contentType: string;
}

/** An Ogg Opus file: OpusHead in the first page, the length from the last page's granule. */
function readOgg(buf: Buffer): AudioInfo {
  const segments = buf[26] ?? 0;
  const payload = 27 + segments;
  if (buf.toString("latin1", payload, payload + 8) !== "OpusHead") throw bad("an Ogg voice note is Opus");
  const preSkip = buf.readUInt16LE(payload + 10);
  let last = buf.lastIndexOf("OggS", buf.length - 4, "latin1");
  while (last > 0 && last + 14 > buf.length) last = buf.lastIndexOf("OggS", last - 1, "latin1");
  if (last < 0) throw bad("no Ogg pages");
  const granule = Number(buf.readBigInt64LE(last + 6));
  return {
    container: "ogg",
    codec: "opus",
    durationMs: Math.max(0, Math.round(((granule - preSkip) / 48_000) * 1000)),
    contentType: "audio/ogg",
  };
}

/** EBML variable-length integer at `at`: its value and length (an ID keeps its marker bits). */
function vint(buf: Buffer, at: number, keepMarker: boolean) {
  const first = buf[at];
  if (first === undefined || first === 0) throw bad("a broken WebM element");
  const length = Math.clz32(first) - 23;
  if (length > 8 || at + length > buf.length) throw bad("a broken WebM element");
  let value = keepMarker ? first : first & (0xff >> length);
  let unknown = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const byte = buf[at + i] as number;
    value = value * 256 + byte;
    if (byte !== 0xff) unknown = false;
  }
  return { value, length, unknown: !keepMarker && unknown };
}

/** A WebM with one Opus track (as browsers record): its codec, and its length from the Duration
 *  element or, as MediaRecorder leaves that out, from the last block's time. */
function readWebm(buf: Buffer): AudioInfo {
  const enter = new Set([0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0x1f43b675, 0xa0]);
  let scale = 1_000_000;
  let duration = 0;
  let cluster = 0;
  let lastBlock = 0;
  const codecs: string[] = [];
  let video = false;
  let docType = "";
  let at = 0;
  while (at < buf.length) {
    const id = vint(buf, at, true);
    const size = vint(buf, at + id.length, false);
    const start = at + id.length + size.length;
    const end = size.unknown ? buf.length : Math.min(buf.length, start + size.value);
    if (id.value === 0x1a45dfa3) {
      // The EBML header: only its DocType matters.
      const header = buf.subarray(start, end);
      const found = header.indexOf(Buffer.from([0x42, 0x82]));
      if (found >= 0) {
        const len = vint(header, found + 2, false);
        docType = header.toString("latin1", found + 2 + len.length, found + 2 + len.length + len.value);
      }
      at = end;
      continue;
    }
    if (enter.has(id.value)) {
      at = start;
      continue;
    }
    const uint = () => {
      let v = 0;
      for (let i = start; i < end; i++) v = v * 256 + (buf[i] as number);
      return v;
    };
    switch (id.value) {
      case 0x2ad7b1:
        scale = uint();
        break;
      case 0x4489:
        duration =
          end - start === 4 ? buf.readFloatBE(start) : end - start === 8 ? buf.readDoubleBE(start) : 0;
        break;
      case 0x86:
        codecs.push(buf.toString("latin1", start, end));
        break;
      case 0x83:
        if (uint() === 1) video = true;
        break;
      case 0xe7:
        cluster = uint();
        break;
      case 0xa3:
      case 0xa1: {
        const track = vint(buf, start, false);
        if (start + track.length + 2 <= end)
          lastBlock = Math.max(lastBlock, cluster + buf.readInt16BE(start + track.length));
        break;
      }
    }
    at = end;
  }
  if (docType !== "webm") throw bad("not a WebM file");
  if (video) throw bad("a voice note has no video");
  if (codecs.length !== 1 || codecs[0] !== "A_OPUS") throw bad("a WebM voice note is one Opus track");
  const ms = (units: number) => (units * scale) / 1_000_000;
  return {
    container: "webm",
    codec: "opus",
    durationMs: Math.round(Math.max(ms(duration), ms(lastBlock))),
    contentType: "audio/webm",
  };
}

/** A voice note: Opus in Ogg or WebM, or AAC in MP4 (M4A), with no video. */
export async function readVoice(path: string, buf: Buffer): Promise<AudioInfo> {
  const kind = sniff(buf);
  if (kind === "ogg") return readOgg(buf);
  if (kind === "webm") return readWebm(buf);
  if (kind === "mp4") {
    const info = await readMp4(path);
    if (info.video) throw bad("a voice note has no video");
    if (info.audio !== "mp4a") throw bad("an MP4 voice note is AAC");
    return { container: "mp4", codec: "aac", durationMs: info.durationMs, contentType: "audio/mp4" };
  }
  throw bad("a voice note is Opus (Ogg or WebM) or AAC (MP4)");
}

/** A clip: MP4 with H.264 video and AAC audio or none. */
export async function readClip(path: string) {
  const info = await readMp4(path);
  if (!info.video) throw bad("a clip has a video track");
  if (info.video !== "avc1" && info.video !== "avc3") throw bad("a clip's video is H.264");
  if (info.audio && info.audio !== "mp4a") throw bad("a clip's sound is AAC");
  return info;
}
