import sharp from "sharp";

/** Small media files made by hand for the tests: just the structure the checks read. */

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
export const box = (type: string, ...children: Buffer[]) => {
  const payload = Buffer.concat(children);
  return Buffer.concat([u32(payload.length + 8), Buffer.from(type, "latin1"), payload]);
};

/** An MP4: ftyp, a moov with one video track (and one sound track) and an mdat. */
export function mp4(
  options: { video?: string; audio?: string | null; seconds?: number; width?: number; height?: number } = {},
) {
  const { video = "avc1", audio = "mp4a", seconds = 5, width = 1280, height = 720 } = options;
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const tkhd = (w: number, h: number) => {
    const b = Buffer.alloc(84);
    b.writeUInt32BE(w << 16, 76);
    b.writeUInt32BE(h << 16, 80);
    return b;
  };
  const hdlr = (handler: string) =>
    Buffer.concat([Buffer.alloc(8), Buffer.from(handler, "latin1"), Buffer.alloc(13)]);
  const stsd = (entry: string) => Buffer.concat([Buffer.alloc(4), u32(1), box(entry, Buffer.alloc(78))]);
  const trak = (handler: string, entry: string, w = 0, h = 0) =>
    box(
      "trak",
      box("tkhd", tkhd(w, h)),
      box("mdia", box("hdlr", hdlr(handler)), box("minf", box("stbl", box("stsd", stsd(entry))))),
    );
  return Buffer.concat([
    box("ftyp", Buffer.from("isom", "latin1"), u32(512), Buffer.from("isomavc1", "latin1")),
    box(
      "moov",
      box("mvhd", mvhd),
      ...(video ? [trak("vide", video, width, height)] : []),
      ...(audio ? [trak("soun", audio)] : []),
    ),
    box("mdat", Buffer.alloc(4096, 7)),
  ]);
}

/** An Ogg Opus file of `seconds`: the OpusHead page and a last page with its granule position. */
export function oggOpus(seconds: number) {
  const page = (granule: bigint, payload: Buffer) => {
    const header = Buffer.alloc(27);
    header.write("OggS", 0, "latin1");
    header.writeBigInt64LE(granule, 6);
    header[26] = 1;
    return Buffer.concat([header, Buffer.from([payload.length]), payload]);
  };
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "latin1");
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(312, 10);
  return Buffer.concat([
    page(0n, head),
    page(0n, Buffer.alloc(40, 1)),
    page(BigInt(seconds * 48_000 + 312), Buffer.alloc(60, 2)),
  ]);
}

const size = (n: number) =>
  n < 127
    ? Buffer.from([0x80 | n])
    : Buffer.concat([Buffer.from([0x01]), Buffer.from(n.toString(16).padStart(14, "0"), "hex")]);
const unknownSize = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const el = (id: string, ...children: Buffer[]) => {
  const payload = Buffer.concat(children);
  return Buffer.concat([Buffer.from(id, "hex"), size(payload.length), payload]);
};
const uint = (n: number) => Buffer.from(n.toString(16).padStart(n > 0xffff ? 6 : 4, "0"), "hex");

/** A WebM as MediaRecorder writes it: no Duration, a segment and clusters of unknown size, and
 *  blocks every 20 ms up to `seconds`. */
export function webmOpus(seconds: number, codec = "A_OPUS") {
  const clusters: Buffer[] = [];
  for (let start = 0; start < seconds * 1000; start += 10_000) {
    const blocks: Buffer[] = [];
    for (let t = 0; t < 10_000 && start + t < seconds * 1000; t += 2000) {
      const block = Buffer.alloc(4 + 20);
      block[0] = 0x81;
      block.writeInt16BE(t, 1);
      block[3] = 0x80;
      blocks.push(el("a3", block));
    }
    clusters.push(
      Buffer.concat([Buffer.from("1f43b675", "hex"), unknownSize, el("e7", uint(start)), ...blocks]),
    );
  }
  return Buffer.concat([
    el("1a45dfa3", el("4286", Buffer.from([1])), el("4282", Buffer.from("webm", "latin1"))),
    Buffer.from("18538067", "hex"),
    unknownSize,
    el("1549a966", el("2ad7b1", uint(1_000_000))),
    el(
      "1654ae6b",
      el(
        "ae",
        el("d7", Buffer.from([1])),
        el("83", Buffer.from([2])),
        el("86", Buffer.from(codec, "latin1")),
      ),
    ),
    ...clusters,
  ]);
}

/** A JPEG with EXIF (a camera and a copyright line) that must not survive. */
export const jpegWithExif = (width = 320, height = 200) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .withExif({ IFD0: { Copyright: "secret place", Make: "SpyCam" } })
    .jpeg()
    .toBuffer();

export const png = (width = 64, height = 64) =>
  sharp({ create: { width, height, channels: 4, background: { r: 10, g: 120, b: 220, alpha: 1 } } })
    .png()
    .toBuffer();
