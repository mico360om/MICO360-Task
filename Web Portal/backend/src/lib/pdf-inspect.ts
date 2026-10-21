/**
 * Read back a PDF produced by `PdfDocument` (tests and diagnostics only).
 *
 * Every line the text engine draws is wrapped in a marked-content span carrying its
 * logical text as /ActualText, so this walks the real file structure (xref → catalog →
 * pages → content streams, inflating FlateDecode streams) and returns those strings
 * page by page. It also exposes the decoded content streams and object bodies.
 */
import { inflateSync } from 'node:zlib';

/** A line the text engine drew: where, how big, and in which faces. */
export interface DrawnLine {
  /** Its logical text (the /ActualText). */
  text: string;
  /** Left edge of its first drawn piece, in points from the page's left edge. */
  x: number;
  /** Its baseline, in points from the top of the page. */
  y: number;
  /** Font size in points. */
  size: number;
  /** The face of each drawn piece, in drawing order: PostScript names without the subset tag (IBMPlexSans-SemiBold). */
  fonts: string[];
}

export interface InspectedPdf {
  /** Logical text of each drawn line, per page, in drawing order. */
  pages: string[][];
  /** The same lines with their position, size and faces, per page. */
  lines: DrawnLine[][];
  /** Decoded (inflated) content stream of each page, as latin1 text. */
  contents: string[];
  /** Object bodies (dictionaries, without stream data) by object number. */
  objects: Map<number, string>;
}

interface PdfObject {
  dict: string;
  stream: Buffer | null;
}

function readObject(pdf: Buffer, src: string, offset: number): PdfObject {
  const head = /^(\d+) (\d+) obj\s*/.exec(src.slice(offset, offset + 40));
  if (!head) throw new Error(`No object at offset ${offset}`);
  const start = offset + head[0].length;
  const streamAt = src.indexOf('stream', start);
  const endObjAt = src.indexOf('endobj', start);
  if (streamAt !== -1 && streamAt < endObjAt && src.slice(start, streamAt).trimEnd().endsWith('>>')) {
    const dict = src.slice(start, streamAt).trim();
    let dataStart = streamAt + 'stream'.length;
    if (src[dataStart] === '\r') dataStart++;
    if (src[dataStart] === '\n') dataStart++;
    const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? NaN);
    if (!Number.isFinite(length)) throw new Error('Stream without a direct /Length');
    let data = pdf.subarray(dataStart, dataStart + length);
    if (/\/Filter\s*\/FlateDecode/.test(dict)) data = inflateSync(data);
    return { dict, stream: Buffer.from(data) };
  }
  return { dict: src.slice(start, endObjAt).trim(), stream: null };
}

/** Decode a PDF literal string body (between the parentheses) to raw bytes. */
function unescapeLiteral(s: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== '\\') {
      bytes.push(c.charCodeAt(0) & 0xff);
      continue;
    }
    const n = s[++i]!;
    const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
    if (n in map) bytes.push(map[n]!);
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? '')) oct += s[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else if (n === '\n' || n === '\r') {
      // line continuation
    } else bytes.push(n.charCodeAt(0) & 0xff);
  }
  return Buffer.from(bytes);
}

/** PDF text string bytes → JS string (UTF-16BE with BOM, else PDFDocEncoding ≈ latin1). */
function decodeTextString(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return bytes.toString('latin1');
}

/** Every "/ActualText (...)" in a content stream, decoded, in order. */
export function actualTexts(content: string): string[] {
  return markedTexts(content).map((t) => t.text);
}

/** Every "/ActualText (...)" in a content stream with where its body ends. */
function markedTexts(content: string): Array<{ text: string; end: number }> {
  const out: Array<{ text: string; end: number }> = [];
  const re = /\/ActualText\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let body = '';
    for (; i < content.length; i++) {
      const c = content[i]!;
      if (c === '\\') {
        body += c + (content[i + 1] ?? '');
        i++;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')' && --depth === 0) break;
      body += c;
    }
    out.push({ text: decodeTextString(unescapeLiteral(body)), end: i });
    re.lastIndex = i;
  }
  return out;
}

/** The drawn lines of a content stream; `fonts` names each /F resource of the page. */
function drawnLines(content: string, fonts: Map<string, string>): DrawnLine[] {
  return markedTexts(content).map(({ text, end }) => {
    const stop = content.indexOf('EMC', end);
    const body = content.slice(end, stop === -1 ? undefined : stop);
    const flip = /1 0 0 -1 0 ([\d.]+) cm/.exec(body);
    const tm = /([-\d.]+) ([-\d.]+) Tm/.exec(body);
    const pageHeight = Number(flip?.[1] ?? 0);
    return {
      text,
      x: Number(tm?.[1] ?? NaN),
      y: pageHeight - Number(tm?.[2] ?? NaN),
      size: Number(/\/F\d+ ([\d.]+) Tf/.exec(body)?.[1] ?? NaN),
      fonts: [...body.matchAll(/\/(F\d+) [\d.]+ Tf/g)].map((f) => fonts.get(f[1]!) ?? f[1]!),
    };
  });
}

export function inspectPdf(pdf: Buffer): InspectedPdf {
  const src = pdf.toString('latin1');
  const startxref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(src)?.[1] ?? NaN);
  if (!Number.isFinite(startxref) || src.slice(startxref, startxref + 4) !== 'xref') throw new Error('Bad startxref');
  const xref = /^xref\s+0 (\d+)\s+/.exec(src.slice(startxref))!;
  const count = Number(xref[1]);
  const offsets: number[] = [];
  const tableStart = startxref + xref[0].length;
  for (let i = 0; i < count; i++) {
    const entry = src.slice(tableStart + i * 20, tableStart + i * 20 + 18);
    offsets.push(entry.endsWith('n') ? Number(entry.slice(0, 10)) : -1);
  }
  const cache = new Map<number, PdfObject>();
  const get = (num: number): PdfObject => {
    let o = cache.get(num);
    if (!o) {
      const off = offsets[num];
      if (off === undefined || off < 0) throw new Error(`Object ${num} not in xref`);
      o = readObject(pdf, src, off);
      cache.set(num, o);
    }
    return o;
  };
  const ref = (dict: string, key: string): number => Number(new RegExp(`/${key} (\\d+) 0 R`).exec(dict)?.[1] ?? NaN);

  const trailer = src.slice(startxref);
  const catalog = get(ref(trailer, 'Root')).dict;
  const pagesDict = get(ref(catalog, 'Pages')).dict;
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(pagesDict)?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((k) => Number(k[1]));

  const pages: string[][] = [];
  const lines: DrawnLine[][] = [];
  const contents: string[] = [];
  for (const kid of kids) {
    const page = get(kid).dict;
    const content = get(ref(page, 'Contents')).stream?.toString('latin1') ?? '';
    contents.push(content);
    pages.push(actualTexts(content));
    // The page's fonts: /F2 → "IBMPlexSans-SemiBold".
    const resourcesRef = ref(page, 'Resources');
    const resources = Number.isFinite(resourcesRef) ? get(resourcesRef).dict : page;
    const fontDict = /\/Font\s*<<([^>]*)>>/.exec(resources)?.[1] ?? '';
    const fonts = new Map<string, string>();
    for (const f of fontDict.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const base = /\/BaseFont \/(?:[A-Z]{6}\+)?([^\s/>]+)/.exec(get(Number(f[2])).dict)?.[1];
      if (base) fonts.set(f[1]!, base);
    }
    lines.push(drawnLines(content, fonts));
  }
  const objects = new Map<number, string>();
  for (let i = 1; i < count; i++) if ((offsets[i] ?? -1) >= 0) objects.set(i, get(i).dict);
  return { pages, lines, contents, objects };
}
