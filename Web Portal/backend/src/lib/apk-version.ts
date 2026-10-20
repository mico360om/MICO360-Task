import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/**
 * The version written inside an Android app file (APK): its manifest's `versionName`. The site
 * tells the phone app which version the download offers, so it says "new version" only when a
 * newer app is really there — not for every update of the website.
 *
 * An APK is a ZIP; its AndroidManifest.xml is in Android's binary XML. Only what's needed is read:
 * the ZIP's directory at the end of the file and the manifest entry, never the whole file.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** An AndroidManifest.xml is a few KB; refuse anything absurd. */
const MAX_MANIFEST = 4 * 1024 * 1024;

/** Read `length` bytes at `offset` (fewer at the end of the file). */
function readAt(fd: number, offset: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const n = readSync(fd, buf, 0, length, offset);
  return buf.subarray(0, n);
}

/** One entry's bytes from a ZIP file on disk, or null. */
function zipEntry(fd: number, size: number, name: string): Buffer | null {
  // The end-of-central-directory record: in the last 22 bytes, or before a comment of up to 64 KB.
  const tailStart = Math.max(0, size - 65_557);
  const tail = readAt(fd, tailStart, size - tailStart);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = tail.readUInt16LE(end + 10);
  const cdSize = tail.readUInt32LE(end + 12);
  const cdOffset = tail.readUInt32LE(end + 16);
  if (cdOffset + cdSize > size) return null;
  const cd = readAt(fd, cdOffset, cdSize);
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== CENTRAL) return null;
    const method = cd.readUInt16LE(p + 10);
    const compressed = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    if (cd.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      if (compressed > MAX_MANIFEST) return null;
      const header = readAt(fd, localOffset, 30);
      if (header.length < 30 || header.readUInt32LE(0) !== LOCAL) return null;
      const data = readAt(fd, localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28), compressed);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_MANIFEST });
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** The strings of a binary XML string pool chunk starting at `at`. */
function stringPool(x: Buffer, at: number, headerSize: number): string[] {
  const count = x.readUInt32LE(at + 8);
  const utf8 = (x.readUInt32LE(at + 16) & 0x100) !== 0;
  const start = at + x.readUInt32LE(at + 20);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let p = start + x.readUInt32LE(at + headerSize + i * 4);
    if (utf8) {
      // UTF-16 length, then UTF-8 length (each 1 or 2 bytes), then the bytes.
      p += x[p]! & 0x80 ? 2 : 1;
      const first = x[p]!;
      const len = first & 0x80 ? ((first & 0x7f) << 8) | x[p + 1]! : first;
      p += first & 0x80 ? 2 : 1;
      out.push(x.toString('utf8', p, p + len));
    } else {
      const first = x.readUInt16LE(p);
      const len = first & 0x8000 ? ((first & 0x7fff) << 16) | x.readUInt16LE(p + 2) : first;
      p += first & 0x8000 ? 4 : 2;
      out.push(x.toString('utf16le', p, p + len * 2));
    }
  }
  return out;
}

/** `versionName` from a binary AndroidManifest.xml, or null. */
export function manifestVersionName(x: Buffer): string | null {
  try {
    if (x.length < 8 || x.readUInt16LE(0) !== 0x0003) return null;
    let p = x.readUInt16LE(2);
    let strings: string[] = [];
    while (p + 8 <= x.length) {
      const type = x.readUInt16LE(p);
      const headerSize = x.readUInt16LE(p + 2);
      const size = x.readUInt32LE(p + 4);
      if (size < 8 || p + size > x.length) return null;
      if (type === 0x0001) strings = stringPool(x, p, headerSize);
      else if (type === 0x0102) {
        // A start tag: after its header come ns, name, attributeStart, attributeSize, attributeCount.
        const ext = p + headerSize;
        if (strings[x.readUInt32LE(ext + 4)] === 'manifest') {
          const attrStart = x.readUInt16LE(ext + 8);
          const attrSize = x.readUInt16LE(ext + 10);
          const attrCount = x.readUInt16LE(ext + 12);
          for (let i = 0; i < attrCount; i++) {
            const a = ext + attrStart + i * attrSize;
            if (strings[x.readUInt32LE(a + 4)] !== 'versionName') continue;
            const raw = x.readInt32LE(a + 8);
            if (raw >= 0) return strings[raw] ?? null;
            // A typed value: a string (type 3) indexes the pool.
            return x.readUInt8(a + 15) === 0x03 ? strings[x.readUInt32LE(a + 16)] ?? null : null;
          }
          return null;
        }
      }
      p += size;
    }
    return null;
  } catch {
    return null;
  }
}

/** The version written inside the app file at `file`, or null (no file, not an app, unreadable). */
export function apkVersionName(file: string): string | null {
  let fd: number | null = null;
  try {
    const { size } = statSync(file);
    fd = openSync(file, 'r');
    const manifest = zipEntry(fd, size, 'AndroidManifest.xml');
    return manifest ? manifestVersionName(manifest) : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * The version of the app file the site offers: the first of `paths` that exists (the order they are
 * served in), read again only when that file is replaced. Null when there is none or it can't be read.
 */
export function createHostedApkVersion(paths: Array<string | null | undefined>): () => string | null {
  let seen = '';
  let version: string | null = null;
  return () => {
    for (const path of paths) {
      if (!path) continue;
      let stamp: string;
      try {
        const s = statSync(path);
        if (!s.isFile()) continue;
        stamp = `${path}:${s.size}:${s.mtimeMs}`;
      } catch {
        continue;
      }
      if (stamp !== seen) {
        seen = stamp;
        version = apkVersionName(path);
      }
      return version;
    }
    seen = '';
    return null;
  };
}
