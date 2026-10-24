import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/** A small, strict zip reader and writer for theme files. It reads only what the central
 *  directory lists, refuses what it cannot check (ZIP64, encryption, methods other than stored
 *  and deflate, more than one disk), and never unpacks more than an entry says it holds. */

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const eocdSignature = 0x06054b50;
const centralSignature = 0x02014b50;
const localSignature = 0x04034b50;

/** The entries of a zip, from its central directory. */
export function readEntries(bytes: Uint8Array, maxEntries: number): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new ZipError("not a zip file");
  // The end record is the last thing in the file, followed by a comment of at most 64 KiB.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (
      view.getUint32(at, true) === eocdSignature &&
      at + 22 + view.getUint16(at + 20, true) === bytes.length
    ) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipError("not a zip file");
  const disk = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const onDisk = view.getUint16(end + 8, true);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (disk !== 0 || centralDisk !== 0 || onDisk !== count) throw new ZipError("split zips are not supported");
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw new ZipError("ZIP64 files are not supported");
  if (count > maxEntries) throw new ZipError(`a theme holds at most ${maxEntries} files`);
  if (centralOffset + centralSize > end) throw new ZipError("the zip is damaged");

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let at = centralOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== centralSignature)
      throw new ZipError("the zip is damaged");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    if (at + 46 + nameLength > end) throw new ZipError("the zip is damaged");
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff)
      throw new ZipError("ZIP64 files are not supported");
    const name = new TextDecoder("utf-8", { fatal: false }).decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );
    if (names.has(name)) throw new ZipError(`${name} is in the zip twice`);
    names.add(name);
    entries.push({ name, method, flags, crc, compressedSize, size, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** One entry's bytes, unpacked and checked against its size and CRC. */
export function extract(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  if (entry.flags & 0x1) throw new ZipError(`${entry.name} is encrypted`);
  if (entry.method !== 0 && entry.method !== 8)
    throw new ZipError(`${entry.name} is packed in a way that is not supported`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.offset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== localSignature)
    throw new ZipError("the zip is damaged");
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const stop = start + entry.compressedSize;
  if (stop > bytes.length) throw new ZipError("the zip is damaged");
  const packed = bytes.subarray(start, stop);
  let data: Uint8Array;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw new ZipError("the zip is damaged");
    data = packed;
  } else {
    try {
      // Never more than the entry says it holds: a bomb stops here, not in memory.
      data = inflateRawSync(packed, { maxOutputLength: Math.max(1, entry.size) });
    } catch {
      throw new ZipError(`${entry.name} could not be unpacked`);
    }
  }
  if (data.length !== entry.size || crc32(data) >>> 0 !== entry.crc >>> 0)
    throw new ZipError(`${entry.name} is damaged`);
  return data;
}

/** A zip of the files given: text deflated, media (already compressed) stored. */
export function writeZip(files: { name: string; bytes: Uint8Array; deflate?: boolean }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  // 2026-01-01 00:00 in DOS time: the same file every time for the same contents.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const packed = file.deflate ? deflateRawSync(file.bytes, { level: 9 }) : file.bytes;
    const method = file.deflate ? 8 : 0;
    const crc = crc32(file.bytes) >>> 0;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, localSignature, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, file.bytes.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, centralSignature, true);
    cv.setUint16(4, 0x0314, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, file.bytes.length, true);
    cv.setUint16(28, name.length, true);
    // A plain file, rw-r--r--.
    cv.setUint32(38, (0o100644 << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, packed);
    centrals.push(central);
    offset += local.length + packed.length;
  }
  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, eocdSignature, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
