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
/** 1.23: the most all the parts unpacked together may come to (many parts each under the limit). */
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PARAGRAPHS = 2000;
const MAX_SLIDES = 200;
const MAX_SHEETS = 10;
const MAX_ROWS = 200;
const MAX_COLS = 30;

/** How much of a file is read (the preview's own caps by default; 1.23 search reads more of it). */
export interface OfficeLimits {
  paragraphs: number;
  slides: number;
  sheets: number;
  rows: number;
  cols: number;
}
const PREVIEW_LIMITS: OfficeLimits = { paragraphs: MAX_PARAGRAPHS, slides: MAX_SLIDES, sheets: MAX_SHEETS, rows: MAX_ROWS, cols: MAX_COLS };

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
  let total = 0;
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
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new PreviewError('This file is too large to preview.');
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

/*
 * Security review (1.23): reading the XML with patterns like /<w:p>([\s\S]*?)<\/w:p>/g took time growing
 * with the square of the text when a tag was never closed (each start searched to the end again) — a
 * 30 KB .docx held the server for over an hour. These read each kind of tag in one pass, the same way:
 * an element is its start tag up to the first end tag after it; once an end tag isn't found, no later
 * start can have one either, so the reading stops there.
 */

const isWordChar = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;
/** Does the tag name end here (so "<w:p" isn't "<w:pPr")? */
const nameEnds = (xml: string, at: number) => {
  const c = xml.charCodeAt(at);
  return c === 62 /* > */ || c === 47 /* / */ || isSpace(c);
};

/** Each <tag …> start tag in order: its attributes' text and whether it closes itself. */
function* startTags(xml: string, tag: string): Generator<{ head: string; selfClosed: boolean; end: number }> {
  const open = `<${tag}`;
  let i = 0;
  for (;;) {
    const s = xml.indexOf(open, i);
    if (s < 0) return;
    const after = s + open.length;
    if (!nameEnds(xml, after)) {
      i = after;
      continue;
    }
    const gt = xml.indexOf('>', after);
    if (gt < 0) return;
    const selfClosed = xml.charCodeAt(gt - 1) === 47;
    yield { head: xml.slice(after, selfClosed ? gt - 1 : gt), selfClosed, end: gt + 1 };
    i = gt + 1;
  }
}

/** Each <tag …>inner</tag> in order (a self-closed one: inner null). */
function* elements(xml: string, tag: string): Generator<{ head: string; inner: string | null }> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let i = 0;
  for (;;) {
    const s = xml.indexOf(open, i);
    if (s < 0) return;
    const after = s + open.length;
    if (!nameEnds(xml, after)) {
      i = after;
      continue;
    }
    const gt = xml.indexOf('>', after);
    if (gt < 0) return;
    if (xml.charCodeAt(gt - 1) === 47) {
      yield { head: xml.slice(after, gt - 1), inner: null };
      i = gt + 1;
      continue;
    }
    const end = xml.indexOf(close, gt + 1);
    if (end < 0) return;
    yield { head: xml.slice(after, gt), inner: xml.slice(gt + 1, end) };
    i = end + close.length;
  }
}

/** The inner text of each <tag>…</tag>. */
const innerTexts = (xml: string, tag: string): string[] => [...elements(xml, tag)].map((e) => e.inner ?? '');

/** A tag's name="value" attributes (in one pass). */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  for (;;) {
    const q = tag.indexOf('="', i);
    if (q < 0) break;
    let s = q;
    while (s > i && (isWordChar(tag.charCodeAt(s - 1)) || tag.charCodeAt(s - 1) === 58 /* : */)) s--;
    const end = tag.indexOf('"', q + 2);
    if (end < 0) break;
    if (s < q) out[tag.slice(s, q)] = decode(tag.slice(q + 2, end));
    i = end + 1;
  }
  return out;
}

/** The text of the <x:t> runs in a fragment, with Word tabs and breaks (in one pass). */
function runsText(xml: string, prefix: 'w' | 'a'): string {
  const lead = `<${prefix}:`;
  const t = `${lead}t`;
  const close = `</${prefix}:t>`;
  const marks: Array<[string, string]> = prefix === 'w' ? [['<w:tab/>', '\t'], ['<w:br/>', '\n'], ['<w:cr/>', '\n']] : [['<a:br/>', '\n']];
  let text = '';
  let runs = true; // false once a run's end is missing (no later run can have one)
  let i = 0;
  for (;;) {
    const s = xml.indexOf(lead, i);
    if (s < 0) break;
    const mark = marks.find(([m]) => xml.startsWith(m, s));
    if (mark) {
      text += mark[1];
      i = s + mark[0].length;
      continue;
    }
    i = s + lead.length;
    if (!runs || !xml.startsWith(t, s) || !nameEnds(xml, s + t.length)) continue;
    const gt = xml.indexOf('>', s + t.length);
    if (gt < 0) break;
    if (xml.charCodeAt(gt - 1) === 47) {
      i = gt + 1;
      continue;
    }
    const end = xml.indexOf(close, gt + 1);
    if (end < 0) {
      runs = false;
      i = gt + 1;
      continue;
    }
    text += decode(xml.slice(gt + 1, end));
    i = end + close.length;
  }
  return text;
}

function documentPreview(xml: string, limits: OfficeLimits): OfficePreview {
  const paragraphs: string[] = [];
  let truncated = false;
  for (const p of elements(xml, 'w:p')) {
    if (p.inner === null) continue;
    const text = runsText(p.inner, 'w');
    if (!text.trim()) continue;
    if (paragraphs.length >= limits.paragraphs) {
      truncated = true;
      break;
    }
    paragraphs.push(text);
  }
  return { kind: 'document', paragraphs, truncated };
}

function slidesPreview(parts: Map<string, string>, limits: OfficeLimits): OfficePreview {
  const numbered = [...parts.keys()]
    .map((name) => ({ name, number: Number(/slide(\d+)\.xml$/.exec(name)?.[1]) }))
    .sort((a, b) => a.number - b.number);
  const slides = numbered.slice(0, limits.slides).map(({ name, number }) => ({
    number,
    lines: [...elements(parts.get(name)!, 'a:p')].map((p) => runsText(p.inner ?? '', 'a')).filter((l) => l.trim()),
  }));
  return { kind: 'slides', slides, truncated: numbered.length > limits.slides };
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetPreview(parts: Map<string, string>, limits: OfficeLimits): OfficePreview {
  const textOf = (xml: string) => innerTexts(xml, 't').map(decode).join('');
  const shared = innerTexts(parts.get('xl/sharedStrings.xml') ?? '', 'si').map(textOf);
  const rels = new Map<string, string>();
  for (const r of startTags(parts.get('xl/_rels/workbook.xml.rels') ?? '', 'Relationship')) {
    const a = attrs(r.head);
    if (a.Id && a.Target) rels.set(a.Id, a.Target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const declared = [...startTags(parts.get('xl/workbook.xml') ?? '', 'sheet')].map((s) => attrs(s.head));
  const sheets: Array<{ name: string; rows: string[][]; truncated: boolean }> = [];
  for (const [i, s] of declared.slice(0, limits.sheets).entries()) {
    const target = rels.get(s['r:id'] ?? '') ?? `worksheets/sheet${i + 1}.xml`;
    const xml = parts.get(`xl/${target}`);
    if (xml === undefined) continue;
    const rows: string[][] = [];
    let truncated = false;
    let width = 0;
    for (const row of elements(xml, 'row')) {
      if (rows.length >= limits.rows) {
        truncated = true;
        break;
      }
      const cells: string[] = [];
      for (const c of elements(row.inner ?? '', 'c')) {
        const a = attrs(c.head);
        const col = a.r ? columnIndex(a.r) : cells.length;
        if (col >= limits.cols) {
          truncated = true;
          continue;
        }
        const body = c.inner ?? '';
        const v = elements(body, 'v').next().value?.inner ?? undefined;
        let value = '';
        if (a.t === 's') value = shared[Number(v)] ?? '';
        else if (a.t === 'inlineStr') value = textOf(body);
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

/** A plain-text preview of a .docx / .xlsx / .pptx file; null for anything else. `limits`: read more (or less) of it. */
export function officePreview(buf: Buffer, filename: string, limits: Partial<OfficeLimits> = {}): OfficePreview | null {
  const caps: OfficeLimits = { ...PREVIEW_LIMITS, ...limits };
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (ext === 'docx') {
    const xml = readParts(buf, (n) => n === 'word/document.xml').get('word/document.xml');
    if (xml === undefined) throw new PreviewError('The file looks damaged and can’t be previewed.');
    return documentPreview(xml, caps);
  }
  if (ext === 'pptx') return slidesPreview(readParts(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)), caps);
  if (ext === 'xlsx') {
    return sheetPreview(readParts(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n)), caps);
  }
  return null;
}
