/**
 * A plain-text look inside Word, Excel and PowerPoint files (.docx / .xlsx / .pptx), for previewing
 * attachments in the app. These files are zip packages of XML: only the parts that carry text are
 * unpacked, each capped in size (a "zip bomb" is refused), and the result is plain strings — never
 * markup — so nothing in a file can run in the page. Older binary formats (.doc/.xls/.ppt) have no
 * preview.
 */
import { inflateRawSync } from 'node:zlib';

export type OfficePreview =
  | { kind: 'document'; paragraphs: string[]; truncated: boolean }
  | { kind: 'sheet'; sheets: Array<{ name: string; rows: string[][]; truncated: boolean }> }
  | { kind: 'slides'; slides: Array<{ number: number; lines: string[] }>; truncated: boolean };

/** Why a file can't be previewed (damaged, or too big to unpack safely). */
export class PreviewError extends Error {}

const MAX_ENTRIES = 5000;
/** Largest single part we unpack. */
const MAX_PART_BYTES = 16 * 1024 * 1024;
const MAX_PARAGRAPHS = 2000;
const MAX_SLIDES = 200;
const MAX_SHEETS = 10;
const MAX_ROWS = 200;
const MAX_COLS = 30;

/** The wanted parts of a zip package, name → UTF-8 text. */
function readParts(buf: Buffer, wanted: (name: string) => boolean): Map<string, string> {
  const damaged = () => new PreviewError('The file looks damaged and can’t be previewed.');
  const tail = buf.subarray(Math.max(0, buf.length - 65_557));
  const at = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (at < 0) throw damaged();
  const eocd = buf.length - tail.length + at;
  if (eocd + 22 > buf.length) throw damaged();
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new PreviewError('The file has too many parts to preview.');
  let p = buf.readUInt32LE(eocd + 16);
  const parts = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw damaged();
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    if (size > MAX_PART_BYTES) throw new PreviewError('This file is too large to preview.');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw damaged();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compressed > buf.length) throw damaged();
    const raw = buf.subarray(start, start + compressed);
    let data: Buffer;
    if (method === 0) data = raw;
    else if (method === 8) {
      try {
        // The size in the header can lie: the cap on the output is what really protects us.
        data = inflateRawSync(raw, { maxOutputLength: MAX_PART_BYTES });
      } catch (err) {
        if (err instanceof RangeError || (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new PreviewError('This file is too large to preview.');
        throw damaged();
      }
    } else throw damaged();
    parts.set(name, data.toString('utf8'));
  }
  return parts;
}

function decode(s: string): string {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/gi, (_m, hex: string, dec: string, named: string) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number(dec));
    return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[named.toLowerCase()]!;
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = decode(m[2]!);
  return out;
}

/** The text of the <x:t> runs in a fragment, with Word tabs and breaks. */
function runsText(xml: string, prefix: 'w' | 'a'): string {
  let text = '';
  const re = prefix === 'w' ? /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\/>/g : /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\/>/g;
  for (const m of xml.matchAll(re)) {
    if (m[1] !== undefined) text += decode(m[1]);
    else if (m[0].includes('tab')) text += '\t';
    else text += '\n';
  }
  return text;
}

function documentPreview(xml: string): OfficePreview {
  const paragraphs: string[] = [];
  let truncated = false;
  for (const m of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const text = runsText(m[1]!, 'w');
    if (!text.trim()) continue;
    if (paragraphs.length >= MAX_PARAGRAPHS) {
      truncated = true;
      break;
    }
    paragraphs.push(text);
  }
  return { kind: 'document', paragraphs, truncated };
}

function slidesPreview(parts: Map<string, string>): OfficePreview {
  const numbered = [...parts.keys()]
    .map((name) => ({ name, number: Number(/slide(\d+)\.xml$/.exec(name)?.[1]) }))
    .sort((a, b) => a.number - b.number);
  const slides = numbered.slice(0, MAX_SLIDES).map(({ name, number }) => ({
    number,
    lines: [...parts.get(name)!.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)].map((m) => runsText(m[1]!, 'a')).filter((l) => l.trim()),
  }));
  return { kind: 'slides', slides, truncated: numbered.length > MAX_SLIDES };
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetPreview(parts: Map<string, string>): OfficePreview {
  const shared = [...(parts.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1]!)).join(''),
  );
  const rels = new Map<string, string>();
  for (const m of (parts.get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) rels.set(a.Id, a.Target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const declared = [...(parts.get('xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*>/g)].map((m) => attrs(m[0]));
  const sheets: Array<{ name: string; rows: string[][]; truncated: boolean }> = [];
  for (const [i, s] of declared.slice(0, MAX_SHEETS).entries()) {
    const target = rels.get(s['r:id'] ?? '') ?? `worksheets/sheet${i + 1}.xml`;
    const xml = parts.get(`xl/${target}`);
    if (xml === undefined) continue;
    const rows: string[][] = [];
    let truncated = false;
    let width = 0;
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        break;
      }
      const cells: string[] = [];
      for (const c of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = attrs(c[1]!);
        const col = a.r ? columnIndex(a.r) : cells.length;
        if (col >= MAX_COLS) {
          truncated = true;
          continue;
        }
        const body = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = '';
        if (a.t === 's') value = shared[Number(v)] ?? '';
        else if (a.t === 'inlineStr') value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1]!)).join('');
        else if (a.t === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else value = v !== undefined ? decode(v) : '';
        while (cells.length < col) cells.push('');
        cells[col] = value;
      }
      width = Math.max(width, cells.length);
      rows.push(cells);
    }
    sheets.push({ name: s.name ?? `Sheet ${i + 1}`, rows: rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')]), truncated });
  }
  return { kind: 'sheet', sheets };
}

/** A plain-text preview of a .docx / .xlsx / .pptx file; null for anything else. */
export function officePreview(buf: Buffer, filename: string): OfficePreview | null {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (ext === 'docx') {
    const xml = readParts(buf, (n) => n === 'word/document.xml').get('word/document.xml');
    if (xml === undefined) throw new PreviewError('The file looks damaged and can’t be previewed.');
    return documentPreview(xml);
  }
  if (ext === 'pptx') return slidesPreview(readParts(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)));
  if (ext === 'xlsx') {
    return sheetPreview(readParts(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n)));
  }
  return null;
}
