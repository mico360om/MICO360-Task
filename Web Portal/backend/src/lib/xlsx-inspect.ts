/**
 * Read back an .xlsx produced by `buildXlsx` (tests and diagnostics only): unzip the package
 * (central directory → local headers → inflate) and pull out sheet names and cell text.
 */
import { inflateRawSync } from 'node:zlib';

/** Every part of the zip package, name → UTF-8 text. */
export function unzipText(buf: Buffer): Map<string, string> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    files.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** Sheet names in order, and each sheet's text cells (inline strings) in document order. */
export function inspectXlsx(buf: Buffer): { sheets: string[]; text: string[][]; parts: Map<string, string> } {
  const parts = unzipText(buf);
  const sheets = [...(parts.get('xl/workbook.xml') ?? '').matchAll(/<sheet name="([^"]+)"/g)].map((m) => unescape(m[1]!));
  const text = sheets.map((_, i) => [...(parts.get(`xl/worksheets/sheet${i + 1}.xml`) ?? '').matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => unescape(m[1]!)));
  return { sheets, text, parts };
}
