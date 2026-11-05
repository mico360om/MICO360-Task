/**
 * 1.23 search: the text of a text-based PDF, read with Node's own zlib — no PDF library. Enough of the
 * file format for search (not for display): every object (and those packed in object streams), the page
 * tree with inherited resources, content streams (FlateDecode, ASCIIHex, ASCII85), the text operators
 * (Tj, TJ, ', "), line moves, fonts' ToUnicode maps (embedded and subset fonts, Arabic too), each line's
 * /ActualText where the writer gave one (this site's own PDFs), and form XObjects. The JPEG pictures of a
 * scanned page are collected for OCR. Capped in pages, bytes, characters and time; it never throws —
 * a damaged or hostile file gives what could be read (often nothing).
 */
import { inflateSync } from 'node:zlib';

export interface PdfTextOptions {
  /** Stop after this many characters of text (default 200,000). */
  maxChars?: number;
  /** Read at most this many pages (default 500). */
  maxPages?: number;
  /** Stop after this long (default 3 s). */
  timeLimitMs?: number;
  /** Collect at most this many JPEG pictures for OCR (default 5). */
  maxImages?: number;
  now?: () => number;
}

export interface PdfText {
  text: string;
  pages: number;
  /** JPEG pictures (DCTDecode) big enough to be a scanned page, in page order. */
  images: Buffer[];
  /** Not all of it was read (a cap or the time limit). */
  truncated: boolean;
}

/** Largest stream we unpack. */
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
/** Largest file we look at. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_OBJECTS = 200_000;
const MAX_DEPTH = 40;
/** The most of one (literal string) kept — far more than any line of text (the whole text is 200k characters). */
const MAX_STRING_BYTES = 256 * 1024;
/** A (literal string)'s backslash escapes. */
const LITERAL_ESCAPES = new Map<number, number>([
  [0x6e, 10],
  [0x72, 13],
  [0x74, 9],
  [0x62, 8],
  [0x66, 12],
  [0x28, 0x28],
  [0x29, 0x29],
  [0x5c, 0x5c],
]);

class PdfName {
  constructor(readonly name: string) {}
}
class PdfRef {
  constructor(readonly num: number) {}
}
class PdfStr {
  constructor(readonly bytes: Buffer) {}
}
class PdfOp {
  constructor(readonly op: string) {}
}
type PdfDict = Map<string, PdfValue>;
type PdfValue = number | boolean | null | PdfName | PdfRef | PdfStr | PdfValue[] | PdfDict;

interface PdfObject {
  value: PdfValue;
  stream?: { dict: PdfDict; raw: Buffer };
}

class Stop extends Error {}

const isDict = (v: PdfValue | undefined): v is PdfDict => v instanceof Map;
const nameOf = (v: PdfValue | undefined): string | null => (v instanceof PdfName ? v.name : null);

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/** A tokenizer/parser over bytes, for object bodies and content streams alike. */
class Lexer {
  pos: number;
  private depth = 0;
  constructor(
    readonly buf: Buffer,
    start = 0,
    readonly end = buf.length,
  ) {
    this.pos = start;
  }

  skipSpace(): void {
    const b = this.buf;
    while (this.pos < this.end) {
      const c = b[this.pos]!;
      if (WS.has(c)) this.pos++;
      else if (c === 0x25) {
        // A comment, to the end of the line.
        while (this.pos < this.end && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  private word(): string {
    const start = this.pos;
    while (this.pos < this.end && !WS.has(this.buf[this.pos]!) && !DELIM.has(this.buf[this.pos]!)) this.pos++;
    return this.buf.toString('latin1', start, this.pos);
  }

  /** The next value or operator; undefined at the end. `objects`: also read "n g R" as a reference. */
  next(objects = true): PdfValue | PdfOp | undefined {
    this.skipSpace();
    if (this.pos >= this.end) return undefined;
    const b = this.buf;
    const c = b[this.pos]!;
    if (c === 0x2f) {
      this.pos++;
      return new PdfName(this.word().replace(/#([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))));
    }
    if (c === 0x28) return this.literal();
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return this.dict();
      }
      return this.hex();
    }
    if (c === 0x5b) {
      this.pos++;
      return this.array(objects);
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.pos++;
      return new PdfOp(String.fromCharCode(c));
    }
    const w = this.word();
    if (!w) {
      this.pos++;
      return new PdfOp('');
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      const n = Number(w);
      if (objects && /^\d+$/.test(w)) {
        // "12 0 R": a reference.
        const save = this.pos;
        this.skipSpace();
        const g = this.word();
        if (/^\d+$/.test(g)) {
          this.skipSpace();
          if (this.buf[this.pos] === 0x52 && (this.pos + 1 >= this.end || WS.has(this.buf[this.pos + 1]!) || DELIM.has(this.buf[this.pos + 1]!))) {
            this.pos++;
            return new PdfRef(n);
          }
        }
        this.pos = save;
      }
      return n;
    }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return new PdfOp(w);
  }

  private guard(): void {
    if (++this.depth > MAX_DEPTH) throw new Stop('too deep');
  }

  private array(objects: boolean): PdfValue[] {
    this.guard();
    const out: PdfValue[] = [];
    for (;;) {
      const v = this.next(objects);
      if (v === undefined) break;
      if (v instanceof PdfOp) {
        if (v.op === ']') break;
        continue;
      }
      out.push(v);
    }
    this.depth--;
    return out;
  }

  private dict(): PdfDict {
    this.guard();
    const out: PdfDict = new Map();
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.end) break;
      if (this.buf[this.pos] === 0x3e && this.buf[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      const key = this.next();
      if (key === undefined) break;
      if (!(key instanceof PdfName)) continue;
      const v = this.next();
      if (v === undefined) break;
      if (v instanceof PdfOp) continue;
      out.set(key.name, v);
    }
    this.depth--;
    return out;
  }

  /**
   * A (literal string). Security review (1.23): its bytes went into a JS array, one element each — one
   * 15 MB string took the reader's process down. Now at most MAX_STRING_BYTES are kept (in a buffer); the
   * rest is read past.
   */
  private literal(): PdfStr {
    const b = this.buf;
    this.pos++;
    let bytes = Buffer.allocUnsafe(64);
    let len = 0;
    const keep = (v: number) => {
      if (len >= MAX_STRING_BYTES) return;
      if (len === bytes.length) {
        const bigger = Buffer.allocUnsafe(Math.min(MAX_STRING_BYTES, bytes.length * 2));
        bytes.copy(bigger, 0, 0, len);
        bytes = bigger;
      }
      bytes[len++] = v;
    };
    let nest = 1;
    while (this.pos < this.end) {
      const c = b[this.pos++]!;
      if (c === 0x5c) {
        const n = b[this.pos++];
        if (n === undefined) break;
        const esc = LITERAL_ESCAPES.get(n);
        if (esc !== undefined) keep(esc);
        else if (n >= 0x30 && n <= 0x37) {
          let oct = n - 0x30;
          for (let k = 0; k < 2 && b[this.pos]! >= 0x30 && b[this.pos]! <= 0x37; k++) oct = oct * 8 + (b[this.pos++]! - 0x30);
          keep(oct & 0xff);
        } else if (n === 0x0d) {
          if (b[this.pos] === 0x0a) this.pos++;
        } else if (n !== 0x0a) keep(n);
        continue;
      }
      if (c === 0x28) nest++;
      else if (c === 0x29 && --nest === 0) break;
      keep(c);
    }
    return new PdfStr(Buffer.from(bytes.subarray(0, len)));
  }

  private hex(): PdfStr {
    this.pos++;
    const start = this.pos;
    while (this.pos < this.end && this.buf[this.pos] !== 0x3e) this.pos++;
    let digits = this.buf.toString('latin1', start, this.pos).replace(/[^0-9a-f]/gi, '');
    this.pos++;
    if (digits.length % 2) digits += '0';
    return new PdfStr(Buffer.from(digits, 'hex'));
  }
}

/** Whitespace between ASCII85 digits (what `\s` matches in Latin-1). */
const isA85Space = (c: number) => (c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0xa0;

/**
 * ASCII85 to bytes (a broken group ends it), into one buffer of at most MAX_STREAM_BYTES. Security review
 * (1.23): it grew a JS array per byte — 16 MB of "z"s (64 MB out) took the reader's process down.
 */
function ascii85(data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(Math.min(MAX_STREAM_BYTES, data.length * 4 + 4));
  let o = 0;
  const group = [0, 0, 0, 0, 0];
  let g = 0;
  const flush = (n: number) => {
    let v = 0;
    for (let k = 0; k < 5; k++) v = v * 85 + (k < n ? group[k]! : 84);
    for (let k = 0; k < n - 1 && o < out.length; k++) out[o++] = (v >>> (24 - 8 * k)) & 0xff;
  };
  let i = 0;
  // A leading "<~" (after any whitespace) is the encoding's own start mark.
  while (i < data.length && isA85Space(data[i]!)) i++;
  if (data[i] === 0x3c) {
    let j = i + 1;
    while (j < data.length && isA85Space(data[j]!)) j++;
    if (data[j] === 0x7e) i = j + 1;
  }
  for (; i < data.length && o < out.length; i++) {
    const c = data[i]!;
    if (isA85Space(c)) continue;
    if (c === 0x7e) break; // "~>": the end
    if (c === 0x7a && g === 0) {
      for (let k = 0; k < 4 && o < out.length; k++) out[o++] = 0;
      continue;
    }
    const d = c - 33;
    if (d < 0 || d > 84) break;
    group[g++] = d;
    if (g === 5) {
      flush(5);
      g = 0;
    }
  }
  if (g) flush(g);
  return out.subarray(0, o);
}

/** A stream's bytes with its filters undone; null when one isn't supported (or for a picture). */
function decodeStream(dict: PdfDict, raw: Buffer): Buffer | null {
  const f = dict.get('Filter');
  const filters = (Array.isArray(f) ? f : f ? [f] : []).map(nameOf);
  let data = raw;
  for (const name of filters) {
    if (name === 'FlateDecode' || name === 'Fl') {
      try {
        data = inflateSync(data, { maxOutputLength: MAX_STREAM_BYTES });
      } catch {
        // A truncated stream still gives what it holds.
        try {
          data = inflateSync(data, { finishFlush: 2 /* Z_SYNC_FLUSH */, maxOutputLength: MAX_STREAM_BYTES });
        } catch {
          return null;
        }
      }
    } else if (name === 'ASCIIHexDecode' || name === 'AHx') {
      let hex = data.toString('latin1').replace(/[^0-9a-f]/gi, '');
      if (hex.length % 2) hex += '0';
      data = Buffer.from(hex, 'hex');
    } else if (name === 'ASCII85Decode' || name === 'A85') data = ascii85(data);
    else return null;
  }
  return data;
}

/** A font's codes → text, one string per glyph: its ToUnicode map, else the bytes as Latin-1 (WinAnsi near enough). */
interface FontDecoder {
  decode(bytes: Buffer): string[];
}

function parseCMap(text: string): FontDecoder {
  const map = new Map<number, string>();
  const lengths = new Set<number>();
  const utf16 = (raw: string) => {
    const hex = raw.replace(/\s+/g, '');
    const b = Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
    let s = '';
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i));
    return s;
  };
  for (const m of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const r of m[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) lengths.add(Math.ceil(r[1]!.length / 2));
  }
  for (const m of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const r of m[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f\s]*)>/gi)) {
      map.set(parseInt(r[1]!, 16), utf16(r[2]!));
      lengths.add(Math.ceil(r[1]!.length / 2));
    }
  }
  for (const m of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of m[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<([0-9a-f\s]*)>|\[([^\]]*)\])/gi)) {
      const lo = parseInt(r[1]!, 16);
      const hi = Math.min(parseInt(r[2]!, 16), lo + 65535);
      lengths.add(Math.ceil(r[1]!.length / 2));
      if (r[4] !== undefined) {
        const base = utf16(r[4]);
        for (let code = lo; code <= hi; code++) {
          const last = base.charCodeAt(base.length - 1) + (code - lo);
          map.set(code, base.slice(0, -1) + String.fromCharCode(last));
        }
      } else {
        const items = [...r[5]!.matchAll(/<([0-9a-f\s]*)>/gi)].map((x) => utf16(x[1]!));
        items.forEach((s, k) => map.set(lo + k, s));
      }
    }
  }
  const widths = [...lengths].filter((n) => n >= 1 && n <= 4).sort((a, b) => a - b);
  const single = widths.length === 1 ? widths[0]! : null;
  return {
    decode(bytes) {
      const out: string[] = [];
      for (let i = 0; i < bytes.length; ) {
        if (single) {
          let code = 0;
          for (let k = 0; k < single; k++) code = code * 256 + (bytes[i + k] ?? 0);
          const g = map.get(code);
          if (g) out.push(g);
          i += single;
          continue;
        }
        let done = false;
        for (const w of widths.length ? widths : [1, 2]) {
          let code = 0;
          for (let k = 0; k < w; k++) code = code * 256 + (bytes[i + k] ?? 0);
          if (map.has(code)) {
            const g = map.get(code)!;
            if (g) out.push(g);
            i += w;
            done = true;
            break;
          }
        }
        if (!done) i += 1;
      }
      return out;
    },
  };
}

const LATIN1: FontDecoder = { decode: (bytes) => [...bytes.toString('latin1')] };
/** A two-byte font with no map can't be read; its codes would come out as noise. */
const UNREADABLE: FontDecoder = { decode: () => [] };

/** Right-to-left letters (Hebrew, Arabic, Syriac, Thaana, N'Ko, and their presentation forms). */
const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
/** Left-to-right letters and digits (Arabic-Indic digits too: numbers read left to right). */
const LTR = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Nd}]/u;
const DIGITS = /^\p{Nd}+$/u;
const dirOf = (unit: string): 'r' | 'l' | 'n' => (RTL.test(unit) && !DIGITS.test(unit) ? 'r' : LTR.test(unit) ? 'l' : 'n');

/**
 * A line of glyphs drawn in visual order (left to right on the page) in reading order: a line that is
 * mostly right-to-left is read from its right end, its left-to-right runs (numbers, English) kept as
 * drawn; a mostly left-to-right line keeps its order, its right-to-left runs reversed. Each glyph's
 * own text (a ligature's letters) stays as it is.
 */
export function visualToLogical(units: readonly string[]): string {
  const dirs = units.map(dirOf);
  const rtl = dirs.filter((d) => d === 'r').length;
  if (rtl === 0) return units.join('');
  const ltr = dirs.filter((d) => d === 'l').length;
  const base: 'r' | 'l' = rtl >= ltr ? 'r' : 'l';
  const other = base === 'r' ? 'l' : 'r';
  // Runs of the other direction (with the neutrals between its letters) keep their own order.
  const items: string[][] = [];
  for (let i = 0; i < units.length; ) {
    if (dirs[i] === other) {
      let j = i;
      let last = i;
      while (j < units.length && dirs[j] !== base) {
        if (dirs[j] === other) last = j;
        j++;
      }
      items.push(units.slice(i, last + 1) as string[]);
      i = last + 1;
    } else {
      items.push([units[i]!]);
      i++;
    }
  }
  if (base === 'r') return items.reverse().map((it) => it.join('')).join('');
  return items.map((it) => (it.length > 1 || dirOf(it[0]!) === 'r' ? it : it)).reduce<string[][]>((acc, it) => acc.concat([it]), []).map((it) => (dirOf(it[0]!) === 'r' ? [...it].reverse().join('') : it.join(''))).join('');
}

/** A PDF text string outside a font (ActualText, metadata): UTF-16 with a byte-order mark, else PDFDoc ≈ Latin-1. */
function textString(bytes: Buffer): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes.readUInt16BE(i));
    return s;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  return bytes.toString('latin1');
}

export function readPdfText(pdf: Buffer, opts: PdfTextOptions = {}): PdfText {
  const maxChars = opts.maxChars ?? 200_000;
  const maxPages = opts.maxPages ?? 500;
  const maxImages = opts.maxImages ?? 5;
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + (opts.timeLimitMs ?? 3000);
  const out = { text: '', pages: 0, images: [] as Buffer[], truncated: false };
  const check = () => {
    if (now() > deadline) throw new Stop('time');
  };
  try {
    if (pdf.length > MAX_FILE_BYTES) {
      out.truncated = true;
      return out;
    }
    read(pdf, out, { maxChars, maxPages, maxImages, check });
  } catch {
    // A cap, the time limit, or a file this reader can't follow: what was read so far is kept.
    out.truncated = true;
  }
  out.text = tidy(out.text).slice(0, maxChars);
  return out;
}

/** Spaces collapsed, blank lines and control characters dropped. */
function tidy(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((l) => l.replace(/[^\S\n]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

interface ReadState {
  text: string;
  pages: number;
  images: Buffer[];
  truncated: boolean;
}

function read(pdf: Buffer, out: ReadState, caps: { maxChars: number; maxPages: number; maxImages: number; check: () => void }): void {
  const objects = new Map<number, PdfObject>();
  const src = pdf.toString('latin1');
  const header = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = header.exec(src))) {
    if (++count > MAX_OBJECTS) break;
    if (count % 500 === 0) caps.check();
    const num = Number(m[1]);
    const lex = new Lexer(pdf, m.index + m[0].length);
    let value: PdfValue;
    try {
      const v = lex.next();
      value = v === undefined || v instanceof PdfOp ? null : v;
    } catch {
      continue;
    }
    const obj: PdfObject = { value };
    lex.skipSpace();
    if (isDict(value) && src.startsWith('stream', lex.pos)) {
      let start = lex.pos + 6;
      if (pdf[start] === 0x0d) start++;
      if (pdf[start] === 0x0a) start++;
      const len = value.get('Length');
      let end = typeof len === 'number' && len >= 0 && start + len <= pdf.length && src.startsWith('endstream', skipWs(src, start + len)) ? start + len : -1;
      if (end < 0) {
        const e = src.indexOf('endstream', start);
        end = e < 0 ? pdf.length : e;
        // The end-of-line before "endstream" isn't data.
        if (pdf[end - 1] === 0x0a) end--;
        if (pdf[end - 1] === 0x0d) end--;
      }
      obj.stream = { dict: value, raw: pdf.subarray(start, end) };
      header.lastIndex = Math.max(header.lastIndex, end);
    }
    objects.set(num, obj);
  }

  const resolve = (v: PdfValue | undefined, depth = 0): PdfValue | undefined => {
    if (v instanceof PdfRef && depth < 8) return resolve(objects.get(v.num)?.value ?? null, depth + 1);
    return v;
  };
  const streamOf = (v: PdfValue | undefined): Buffer | null => {
    const o = v instanceof PdfRef ? objects.get(v.num) : undefined;
    return o?.stream ? decodeStream(o.stream.dict, o.stream.raw) : null;
  };

  // Objects packed in object streams (PDF 1.5+); a top-level one of the same number wins.
  for (const [, o] of [...objects]) {
    if (!o.stream || nameOf(o.stream.dict.get('Type')) !== 'ObjStm') continue;
    caps.check();
    const data = decodeStream(o.stream.dict, o.stream.raw);
    const n = o.stream.dict.get('N');
    const first = o.stream.dict.get('First');
    if (!data || typeof n !== 'number' || typeof first !== 'number') continue;
    const head = new Lexer(data, 0, Math.min(first, data.length));
    const pairs: number[] = [];
    for (let k = 0; k < n * 2; k++) {
      const v = head.next(false);
      if (typeof v !== 'number') break;
      pairs.push(v);
    }
    for (let k = 0; k + 1 < pairs.length; k += 2) {
      const num = pairs[k]!;
      if (objects.has(num)) continue;
      try {
        const v = new Lexer(data, first + pairs[k + 1]!).next();
        if (v !== undefined && !(v instanceof PdfOp)) objects.set(num, { value: v });
      } catch {
        // skip it
      }
    }
  }

  // The pages, in order, with the resources each inherits.
  const pages: { dict: PdfDict; resources: PdfDict | undefined }[] = [];
  const seen = new Set<PdfDict>();
  const walk = (node: PdfValue | undefined, inherited: PdfDict | undefined, depth: number) => {
    const d = resolve(node);
    if (!isDict(d) || seen.has(d) || depth > 30 || pages.length >= caps.maxPages) return;
    seen.add(d);
    const res = resolve(d.get('Resources'));
    const resources = isDict(res) ? res : inherited;
    const kids = resolve(d.get('Kids'));
    if (Array.isArray(kids)) for (const k of kids) walk(k, resources, depth + 1);
    else if (nameOf(d.get('Type')) === 'Page' || d.has('Contents')) pages.push({ dict: d, resources });
  };
  const catalog = [...objects.values()].map((o) => o.value).find((v) => isDict(v) && nameOf(v.get('Type')) === 'Catalog') as PdfDict | undefined;
  if (catalog) walk(catalog.get('Pages'), undefined, 0);
  if (pages.length === 0) {
    for (const o of objects.values()) {
      if (isDict(o.value) && nameOf(o.value.get('Type')) === 'Page' && pages.length < caps.maxPages) pages.push({ dict: o.value, resources: isDict(resolve(o.value.get('Resources'))) ? (resolve(o.value.get('Resources')) as PdfDict) : undefined });
    }
  }
  if (pages.length >= caps.maxPages) out.truncated = true;

  const decoders = new Map<PdfDict, FontDecoder>();
  const decoderOf = (fontRef: PdfValue | undefined): FontDecoder => {
    const font = resolve(fontRef);
    if (!isDict(font)) return LATIN1;
    const known = decoders.get(font);
    if (known) return known;
    const cmap = streamOf(font.get('ToUnicode'));
    const decoder = cmap ? parseCMap(cmap.toString('latin1')) : nameOf(font.get('Subtype')) === 'Type0' ? UNREADABLE : LATIN1;
    decoders.set(font, decoder);
    return decoder;
  };

  // The line being read, glyph by glyph in the order drawn; a line break puts it in reading order.
  let line: string[] = [];
  const add = (s: string) => {
    out.text += s;
    if (out.text.length > caps.maxChars) {
      out.truncated = true;
      throw new Stop('enough');
    }
  };
  const flush = () => {
    if (line.length) add(visualToLogical(line));
    line = [];
  };
  const glyphs = (units: string[]) => {
    for (const u of units) line.push(u);
    if (line.length > 20_000) flush();
  };
  const endsInSpace = () => (line.length ? /\s$/.test(line[line.length - 1]!) : out.text === '' || /\s$/.test(out.text));
  const space = () => {
    if (!endsInSpace()) line.push(' ');
  };
  const newline = () => {
    flush();
    if (out.text && !out.text.endsWith('\n')) add('\n');
  };

  const runContent = (content: Buffer, resources: PdfDict | undefined, depth: number) => {
    const fonts = resolve(resources?.get('Font'));
    const xobjects = resolve(resources?.get('XObject'));
    const lex = new Lexer(content);
    const operands: PdfValue[] = [];
    let font: FontDecoder = LATIN1;
    let lastY: number | null = null;
    // Inside a marked-content span with /ActualText: that text is shown instead of the glyphs.
    const spans: boolean[] = [];
    const replaced = () => spans.includes(true);
    const show = (s: PdfStr) => {
      if (!replaced()) glyphs(font.decode(s.bytes));
    };
    let steps = 0;
    for (;;) {
      if (++steps % 2000 === 0) caps.check();
      const t = lex.next(false);
      if (t === undefined) break;
      if (!(t instanceof PdfOp)) {
        operands.push(t);
        if (operands.length > 64) operands.shift();
        continue;
      }
      const op = t.op;
      const args = operands.splice(0);
      switch (op) {
        case 'BI': {
          // An inline picture: skip its data ("ID" … "EI").
          const id = content.indexOf('ID', lex.pos, 'latin1');
          const rest = id < 0 ? '' : content.toString('latin1', id + 2);
          const ei = /\sEI(?=\s|$)/.exec(rest);
          lex.pos = id < 0 || !ei ? content.length : id + 2 + ei.index + ei[0].length;
          break;
        }
        case 'Tf': {
          const name = nameOf(args[0]);
          font = name && isDict(fonts) ? decoderOf(fonts.get(name)) : LATIN1;
          break;
        }
        case 'Tj':
          if (args[0] instanceof PdfStr) show(args[0]);
          break;
        case "'":
        case '"':
          newline();
          if (args[args.length - 1] instanceof PdfStr) show(args[args.length - 1] as PdfStr);
          break;
        case 'TJ':
          if (Array.isArray(args[0])) {
            for (const part of args[0]) {
              if (part instanceof PdfStr) show(part);
              else if (typeof part === 'number' && part < -180 && !replaced()) space();
            }
          }
          break;
        case 'Td':
        case 'TD':
          if (typeof args[1] === 'number' && args[1] !== 0) newline();
          else if (typeof args[0] === 'number' && args[0] > 0) space();
          break;
        case 'T*':
          newline();
          break;
        case 'Tm': {
          const y = typeof args[5] === 'number' ? args[5] : null;
          if (y !== null && lastY !== null && Math.abs(y - lastY) > 0.5) newline();
          lastY = y;
          break;
        }
        case 'BT':
          lastY = null;
          break;
        case 'ET':
          space();
          break;
        case 'BDC': {
          const props = isDict(args[1]) ? args[1] : isDict(resolve(args[1])) ? (resolve(args[1]) as PdfDict) : null;
          const actual = props?.get('ActualText');
          if (actual instanceof PdfStr) {
            // Already in reading order: on its own line, as it is.
            newline();
            add(`${textString(actual.bytes)}\n`);
            spans.push(true);
          } else spans.push(false);
          break;
        }
        case 'BMC':
          spans.push(false);
          break;
        case 'EMC':
          spans.pop();
          break;
        case 'Do': {
          const name = nameOf(args[0]);
          const ref = name && isDict(xobjects) ? xobjects.get(name) : undefined;
          const x = ref instanceof PdfRef ? objects.get(ref.num) : undefined;
          if (!x?.stream) break;
          const sub = nameOf(x.stream.dict.get('Subtype'));
          if (sub === 'Form' && depth < 3) {
            const data = decodeStream(x.stream.dict, x.stream.raw);
            const own = resolve(x.stream.dict.get('Resources'));
            if (data) runContent(data, isDict(own) ? own : resources, depth + 1);
          } else if (sub === 'Image' && out.images.length < caps.maxImages) {
            const f = x.stream.dict.get('Filter');
            const filters = (Array.isArray(f) ? f : f ? [f] : []).map(nameOf);
            const w = resolve(x.stream.dict.get('Width'));
            const h = resolve(x.stream.dict.get('Height'));
            // A scanned page: a JPEG at least 300 pixels on its short side.
            if (filters.length === 1 && filters[0] === 'DCTDecode' && typeof w === 'number' && typeof h === 'number' && Math.min(w, h) >= 300) out.images.push(Buffer.from(x.stream.raw));
          }
          break;
        }
        default:
          break;
      }
    }
  };

  for (const page of pages) {
    caps.check();
    out.pages += 1;
    const contents = page.dict.get('Contents');
    const list = Array.isArray(resolve(contents)) ? (resolve(contents) as PdfValue[]) : [contents];
    for (const c of list) {
      const data = streamOf(c as PdfValue);
      if (data) runContent(data, page.resources, 0);
    }
    newline();
  }
}

function skipWs(src: string, at: number): number {
  let i = at;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  return i;
}
