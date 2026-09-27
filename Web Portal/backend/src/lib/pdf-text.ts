/**
 * Unicode text engine shared by the PDF writers (`pdf-document.ts`, `pdf.ts`).
 *
 * - Fonts: embedded Noto Sans (Latin, Greek, Cyrillic, punctuation) and Noto Naskh
 *   Arabic, both regular + bold, loaded from their npm packages at runtime (no build
 *   step copies assets). pdfkit subsets them, so a PDF only carries the glyphs it uses.
 * - Bidi: the Unicode Bidirectional Algorithm (UAX #9, via bidi-js) resolves embedding
 *   levels for a whole paragraph; lines are wrapped on the logical text and each line is
 *   then reordered visually, with mirrored brackets in right-to-left runs.
 * - Shaping: fontkit (the shaper pdfkit itself uses) applies the Arabic joining forms
 *   (init/medi/fina/isol, lam-alef ligatures, mark positioning).
 *
 * Why not just call `doc.text()`? pdfkit lays text out word by word and lets fontkit
 * reverse each word by script, so Arabic words come out in the wrong order and mixed
 * Arabic/English lines are scrambled. Here pdfkit only ever receives one homogeneous
 * run at a time (one font, one direction) at an explicit x position, in visual order.
 */
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import type { FontkitFont } from 'fontkit';
import bidiFactory from 'bidi-js';
import type { EmbeddingLevels } from 'bidi-js';

const bidi = bidiFactory();

export type FontKey = 'latin' | 'latin-bold' | 'arabic' | 'arabic-bold';

/** Font files, resolved from the installed npm packages (see package.json). */
const FONT_FILES: Record<FontKey, string> = {
  latin: '@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf',
  'latin-bold': '@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf',
  arabic: '@expo-google-fonts/noto-naskh-arabic/400Regular/NotoNaskhArabic_400Regular.ttf',
  'arabic-bold': '@expo-google-fonts/noto-naskh-arabic/700Bold/NotoNaskhArabic_700Bold.ttf',
};

export const FONT_KEYS = Object.keys(FONT_FILES) as FontKey[];

interface LoadedFont {
  data: Buffer;
  font: FontkitFont;
}
const loadedFonts = new Map<FontKey, LoadedFont>();

function loadFont(key: FontKey): LoadedFont {
  let f = loadedFonts.get(key);
  if (!f) {
    const data = readFileSync(require.resolve(FONT_FILES[key]));
    f = { data, font: fontkit.create(data) };
    loadedFonts.set(key, f);
  }
  return f;
}

/** Raw TTF bytes for a font key (for registering with a pdfkit document). */
export function fontData(key: FontKey): Buffer {
  return loadFont(key).data;
}

/** Register the four embedded fonts on a pdfkit document under their FontKey names. */
export function registerPdfFonts(doc: PDFKit.PDFDocument): void {
  for (const key of FONT_KEYS) doc.registerFont(key, fontData(key));
}

// ---------------------------------------------------------------------------
// Character classification
// ---------------------------------------------------------------------------

function isArabicScript(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x0870 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfefe)
  );
}

/** Explicit bidi formatting characters: they steer the algorithm but are never drawn. */
function isBidiControl(cp: number): boolean {
  return cp === 0x200e || cp === 0x200f || cp === 0x061c || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

const ZWNJ = 0x200c; // zero-width non-joiner
const ZWJ = 0x200d; // zero-width joiner
const FSI = String.fromCharCode(0x2068); // First Strong Isolate
const PDI = String.fromCharCode(0x2069); // Pop Directional Isolate

/** Default-ignorable characters that are silently dropped when no font draws them. */
function isIgnorable(cp: number): boolean {
  return cp === 0x200b || cp === 0x2060 || cp === 0xfeff || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x00ad;
}

/** Readable stand-ins for common symbols neither font carries (arrows, check marks). */
const SYMBOL_FALLBACKS: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '⇒': '=>',
  '✓': 'v',
  '✔': 'v',
  '✗': 'x',
  '✘': 'x',
};

function covered(cp: number): boolean {
  return loadFont('latin').font.hasGlyphForCodePoint(cp) || loadFont('arabic').font.hasGlyphForCodePoint(cp);
}

/**
 * Normalise text for layout: tabs → space, control characters dropped, and any
 * character neither embedded font can draw (emoji, CJK, …) replaced by a readable
 * fallback or "?" — never a silent .notdef box. Astral code points never survive,
 * so every remaining character is a single UTF-16 unit (bidi-js works per unit).
 */
export function sanitizeText(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\t') {
      out += ' ';
    } else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) {
      // C0/C1 control (incl. stray CR) — drop
    } else if (isBidiControl(cp) || cp === ZWNJ || cp === ZWJ) {
      out += ch;
    } else if (cp <= 0xffff && covered(cp)) {
      out += ch;
    } else if (isIgnorable(cp)) {
      // variation selectors, zero-width space, BOM, soft hyphen — drop
    } else {
      out += SYMBOL_FALLBACKS[ch] ?? '?';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shaping / measurement
// ---------------------------------------------------------------------------

/**
 * OpenType features for every run we shape. A fresh object each call: fontkit writes
 * the features it applied back into the object it is given, so sharing one would leak
 * Arabic positional features into later runs. `rtlm` is off because mirroring is done
 * explicitly with the Unicode Bidi_Mirroring_Glyph data (font-independent).
 */
export function shapingFeatures(): Record<string, boolean> {
  return { rtlm: false };
}

interface Shaped {
  /** Advance width in ems. */
  em: number;
  /** Whether fontkit will reverse the glyphs of this string (its script is right-to-left). */
  rtl: boolean;
}

const MAX_CACHE = 20_000;
const shapeCache = new Map<string, Shaped>();

function shape(key: FontKey, text: string): Shaped {
  const cacheKey = `${key}\u0000${text}`;
  let s = shapeCache.get(cacheKey);
  if (!s) {
    const { font } = loadFont(key);
    const run = font.layout(text, shapingFeatures());
    s = { em: run.advanceWidth / font.unitsPerEm, rtl: run.direction === 'rtl' };
    if (shapeCache.size >= MAX_CACHE) shapeCache.clear();
    shapeCache.set(cacheKey, s);
  }
  return s;
}

function reverseUnits(s: string): string {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += s[i];
  return out;
}

// ---------------------------------------------------------------------------
// Paragraph layout
// ---------------------------------------------------------------------------

/** One homogeneous piece of a line: one font, one direction, already in visual order. */
export interface LineSegment {
  font: FontKey;
  /** String to hand to pdfkit (pre-arranged so fontkit's own reversal yields visual order). */
  draw: string;
  /** The same characters in logical order (mirrored where right-to-left). */
  logical: string;
  /** Resolved bidi level is odd (right-to-left run). */
  rtl: boolean;
  /** Advance width in points at the size the line was laid out with. */
  width: number;
}

export interface TextLine {
  /** Segments in left-to-right visual order. */
  segments: LineSegment[];
  /** Total advance width in points. */
  width: number;
  /** Paragraph direction is right-to-left (so the line is aligned to the right edge by default). */
  rtl: boolean;
  /** The line contains Arabic-font glyphs (needs taller line spacing). */
  arabic: boolean;
  /** The line's text in logical order, bidi controls removed (written to the PDF as /ActualText). */
  text: string;
}

export interface LayoutOptions {
  size: number;
  bold?: boolean;
  /** Wrap to this width (points). Omit for a single unwrapped line per paragraph. */
  maxWidth?: number;
  /** Force the paragraph direction; default is auto (first strong character, UAX #9 P2/P3). */
  direction?: 'ltr' | 'rtl';
}

interface Paragraph {
  text: string;
  levels: EmbeddingLevels;
  fonts: FontKey[];
  rtl: boolean;
  size: number;
}

function assignFonts(text: string, levels: Uint8Array, bold: boolean): FontKey[] {
  const latin: FontKey = bold ? 'latin-bold' : 'latin';
  const arabic: FontKey = bold ? 'arabic-bold' : 'arabic';
  const fonts: FontKey[] = new Array<FontKey>(text.length);
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    let key: FontKey;
    if (isArabicScript(cp)) key = arabic;
    else if (cp === ZWJ || cp === ZWNJ) key = i > 0 ? fonts[i - 1]! : latin;
    else if (bidi.getBidiCharTypeName(text[i]!) === 'L') key = latin;
    // Neutrals/numbers follow the run they sit in: Arabic font inside right-to-left runs.
    else key = (levels[i]! & 1) === 1 ? arabic : latin;
    if (!loadFont(key).font.hasGlyphForCodePoint(cp)) {
      const other: FontKey = key === latin ? arabic : latin;
      if (loadFont(other).font.hasGlyphForCodePoint(cp)) key = other;
    }
    fonts[i] = key;
  }
  return fonts;
}

function prepareParagraph(raw: string, opts: LayoutOptions): Paragraph {
  const text = sanitizeText(raw);
  const levels = bidi.getEmbeddingLevels(text, opts.direction);
  const rtl = ((levels.paragraphs[0]?.level ?? (opts.direction === 'rtl' ? 1 : 0)) & 1) === 1;
  return { text, levels, fonts: assignFonts(text, levels.levels, opts.bold ?? false), rtl, size: opts.size };
}

/** Width in points of text[a, b) (logical order), shaped per font run. */
function spanWidth(p: Paragraph, a: number, b: number): number {
  let total = 0;
  let runStart = a;
  for (let i = a + 1; i <= b; i++) {
    if (i === b || p.fonts[i] !== p.fonts[runStart]) {
      total += shape(p.fonts[runStart]!, p.text.slice(runStart, i)).em;
      runStart = i;
    }
  }
  return total * p.size;
}

const EPSILON = 0.01;

function isMark(cp: number): boolean {
  // Combining marks (Arabic harakat, Latin diacritics) must stay with their base letter.
  return (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x064b && cp <= 0x065f) || cp === 0x0670 || (cp >= 0x06d6 && cp <= 0x06ed) || (cp >= 0x08d3 && cp <= 0x08ff);
}

/** Greedy word wrap on the logical text. Returns [start, end) ranges with outer spaces trimmed. */
function wrapRanges(p: Paragraph, maxWidth: number | undefined): Array<[number, number]> {
  const s = p.text;
  if (maxWidth === undefined) {
    let a = 0;
    let b = s.length;
    while (a < b && s[a] === ' ') a++;
    while (b > a && s[b - 1] === ' ') b--;
    return [[a, b]];
  }
  const lines: Array<[number, number]> = [];
  let lineStart = -1;
  let lineEnd = -1;
  let lineWidth = 0;
  let i = 0;
  while (i < s.length) {
    const spaceStart = i;
    while (i < s.length && s[i] === ' ') i++;
    const spaceEnd = i;
    if (i >= s.length) break;
    const wordStart = i;
    while (i < s.length && s[i] !== ' ') i++;
    const wordEnd = i;
    const wordWidth = spanWidth(p, wordStart, wordEnd);
    if (lineStart >= 0) {
      const spaceWidth = spanWidth(p, spaceStart, spaceEnd);
      if (lineWidth + spaceWidth + wordWidth <= maxWidth + EPSILON) {
        lineEnd = wordEnd;
        lineWidth += spaceWidth + wordWidth;
        continue;
      }
      lines.push([lineStart, lineEnd]);
    }
    if (wordWidth <= maxWidth + EPSILON) {
      lineStart = wordStart;
      lineEnd = wordEnd;
      lineWidth = wordWidth;
      continue;
    }
    // A single word wider than the line (long URL, e-mail, id): hard-break it.
    let cs = wordStart;
    for (;;) {
      let ce = cs + 1;
      while (ce < wordEnd && isMark(s.charCodeAt(ce))) ce++;
      for (;;) {
        let next = ce + 1;
        while (next < wordEnd && isMark(s.charCodeAt(next))) next++;
        if (ce >= wordEnd || spanWidth(p, cs, Math.min(next, wordEnd)) > maxWidth + EPSILON) break;
        ce = Math.min(next, wordEnd);
      }
      if (ce >= wordEnd) {
        lineStart = cs;
        lineEnd = wordEnd;
        lineWidth = spanWidth(p, cs, wordEnd);
        break;
      }
      lines.push([cs, ce]);
      cs = ce;
    }
  }
  if (lineStart >= 0) lines.push([lineStart, lineEnd]);
  if (lines.length === 0) lines.push([0, 0]);
  return lines;
}

/** Reorder one line visually and cut it into homogeneous segments. */
function buildLine(p: Paragraph, a: number, b: number): TextLine {
  const segments: LineSegment[] = [];
  if (b > a) {
    const order = bidi.getReorderedIndices(p.text, p.levels, a, b - 1).slice(a, b);
    let cur: { font: FontKey; level: number; chars: string[] } | null = null;
    const flush = (): void => {
      if (!cur || cur.chars.length === 0) return;
      const rtl = (cur.level & 1) === 1;
      const visual = cur.chars.join('');
      const logical = rtl ? reverseUnits(visual) : visual;
      // fontkit reverses a run whenever its script is right-to-left (Arabic letters or
      // Arabic-Indic digits). Hand it the string that makes the glyphs come out in visual
      // order either way: logical order when its reversal is wanted, otherwise pre-reversed
      // (e.g. neutral punctuation at the edge of an Arabic run, or Arabic-Indic digits
      // inside a left-to-right number run). Such runs never contain joining letters.
      const draw = shape(cur.font, logical).rtl === rtl ? logical : reverseUnits(logical);
      segments.push({ font: cur.font, draw, logical, rtl, width: shape(cur.font, draw).em * p.size });
    };
    for (const idx of order) {
      const ch = p.text[idx]!;
      if (isBidiControl(ch.charCodeAt(0))) continue;
      const level = p.levels.levels[idx]!;
      const font = p.fonts[idx]!;
      if (!cur || cur.font !== font || cur.level !== level) {
        flush();
        cur = { font, level, chars: [] };
      }
      cur.chars.push(level & 1 ? (bidi.getMirroredCharacter(ch) ?? ch) : ch);
    }
    flush();
  }
  const width = segments.reduce((w, s) => w + s.width, 0);
  let text = '';
  for (let i = a; i < b; i++) if (!isBidiControl(p.text.charCodeAt(i))) text += p.text[i];
  return {
    segments,
    width,
    rtl: p.rtl,
    arabic: segments.some((s) => s.font.startsWith('arabic')),
    text,
  };
}

/** Base direction of a paragraph per UAX #9 P2/P3 (first strong character; isolates skipped; default LTR). */
export function textDirection(text: string): 'ltr' | 'rtl' {
  const first = text.replace(/\r\n?/g, '\n').split('\n').find((p) => /\S/.test(p)) ?? '';
  const levels = bidi.getEmbeddingLevels(sanitizeText(first));
  return ((levels.paragraphs[0]?.level ?? 0) & 1) === 1 ? 'rtl' : 'ltr';
}

/** Wrap a fragment in First-Strong-Isolate … Pop-Directional-Isolate so neighbouring text can't reorder it. */
export function isolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}

/**
 * Lay out text into visual lines. Embedded "\n" start new paragraphs (each with its
 * own direction); with `maxWidth` each paragraph is word-wrapped to that width.
 */
export function layoutText(text: string, opts: LayoutOptions): TextLine[] {
  const lines: TextLine[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    const p = prepareParagraph(para, opts);
    for (const [a, b] of wrapRanges(p, opts.maxWidth)) lines.push(buildLine(p, a, b));
  }
  return lines;
}

/** Width in points of a single line of text (no wrapping; embedded newlines → widest line). */
export function measureText(text: string, size: number, bold = false): number {
  return layoutText(text, { size, bold }).reduce((w, l) => Math.max(w, l.width), 0);
}

/**
 * Vertical box of a line: total height and the baseline offset from its top (points).
 * Arabic lines (or any line when `arabic` is forced, e.g. to keep a table row's
 * baselines level) get more room for Naskh's tall ascenders and deep descenders.
 */
export function lineBox(line: TextLine | null, size: number, arabic = line?.arabic ?? false): { height: number; ascent: number } {
  return arabic ? { height: size * 1.72, ascent: size * 1.14 } : { height: size * 1.4, ascent: size * 1.02 };
}

/**
 * Draw a laid-out line with its left edge at `x` and its baseline at `baseline`
 * (pdfkit top-down coordinates). `color` is any pdfkit color value.
 *
 * The line is wrapped in a marked-content span whose /ActualText is the logical
 * text, so copy/paste, search and screen readers get "خالد البلوشي" rather than the
 * visually ordered, contextually shaped glyphs.
 */
export function drawTextLine(doc: PDFKit.PDFDocument, line: TextLine, x: number, baseline: number, size: number, color: PDFKit.Mixins.ColorValue): void {
  if (line.segments.length === 0) return;
  doc.markContent('Span', { actual: line.text });
  let cx = x;
  for (const seg of line.segments) {
    if (seg.draw.trim()) {
      doc
        .font(seg.font)
        .fontSize(size)
        .fillColor(color)
        .text(seg.draw, cx, baseline, {
          lineBreak: false,
          baseline: 'alphabetic',
          // pdfkit types only allow a tag list; an object is what lets us switch rtlm off.
          // A truthy value also makes pdfkit shape the whole run at once instead of per word.
          features: shapingFeatures() as unknown as PDFKit.Mixins.OpenTypeFeatures[],
        });
    }
    cx += seg.width;
  }
  doc.endMarkedContent();
}
