/**
 * A small document builder that flows text down A4 pages and breaks to new pages
 * automatically. Built on pdfkit, with every string going through the Unicode text
 * engine in `pdf-text.ts`: embedded IBM Plex Sans + Noto Naskh Arabic fonts, bidi
 * reordering and Arabic shaping. Arabic, English and mixed lines therefore render as
 * real, joined glyphs in the right order; right-to-left paragraphs align to the right
 * edge; long text wraps to the column; tables repeat their header on every page.
 *
 * 1.23.10 — one PDF standard for every document (owner, 10 Nov 2026): A4 with 14 mm side and
 * 12 mm top/bottom margins; one font family; body 9.5 pt, small 8 pt, section headings 11 pt,
 * tables 8.5 pt (never under 7.5 pt); a slim header (the project's picture on the left, the
 * company's logo on the right, both at most 26 pt tall); a slim running header on every later
 * page and a footer on every page (company · "Printed … by …" · "Page X of Y"), drawn as page
 * artifacts; one slim summary strip in the site's colour scheme; tables sized from their
 * content, a row never split (a row taller than a page continues under "(continued)"), and a
 * section turned landscape when its table can't fit across a portrait page; headings kept with
 * what follows them, small sections kept whole, and never a blank page (a page is only added
 * once something is drawn on it).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { drawTextLine, layoutStyledText, layoutText, lineBox, measureText, registerPdfFonts, type StyledRun, type TextLine } from './pdf-text';
import { printableImage } from './pdf-image';
import { fitColumns, measureColumns, paginateRows } from './pdf-table-layout';
import { DUE_SOON_TONES, OVERDUE_TONES, STATUS_TONES, type Tone } from './colour-scheme';

export type RGB = [number, number, number];

const INK: RGB = [0.11, 0.1, 0.09];
const MUTED: RGB = [0.42, 0.4, 0.38];
const BRAND: RGB = [0.66, 0.12, 0.12];
const LINE: RGB = [0.82, 0.8, 0.78];
const WHITE: RGB = [1, 1, 1];
const SUCCESS: RGB = [0.18, 0.49, 0.33];
const WARNING: RGB = [0.72, 0.47, 0.12];

/** One millimetre in points. */
export const MM = 72 / 25.4;

/** The PDF standard's measures (points). */
export const PDF_STANDARD = {
  margin: { side: 14 * MM, top: 12 * MM, bottom: 12 * MM },
  type: {
    /** A document's own title (a task's, a meeting's, a report's). */
    title: 15.5,
    /** A part of a document ("Final Minutes of Meeting"). */
    part: 12,
    heading: 11,
    subheading: 10,
    body: 9.5,
    /** Facts and key/value details, as tables. */
    data: 8.5,
    small: 8,
    /** Labels, eyebrows, badges and the footer. */
    label: 7.5,
    /** A summary strip's values. */
    value: 10.5,
    table: 8.5,
    /** Smart fitting never sets a table smaller than this. */
    tableMin: 7.5,
    /** Nothing is ever set smaller than this. */
    min: 7.5,
  },
  /** Spacing steps. */
  space: { xs: 2, s: 4, m: 6, l: 10, xl: 14 },
  /** The header's project picture and company logo: at most this tall. */
  mark: 26,
  /** The running header's picture and logo. */
  runningMark: 14,
} as const;

const SIDE = PDF_STANDARD.margin.side;
const TOP = PDF_STANDARD.margin.top;
const BOTTOM = PDF_STANDARD.margin.bottom;
const TYPE = PDF_STANDARD.type;
const MARK = PDF_STANDARD.mark;
const RUN_MARK = PDF_STANDARD.runningMark;
/** The running header's rule, under its row; body text starts 8 pt below it on later pages. */
const RUN_RULE = TOP + RUN_MARK + 4;
const CONTINUATION_TOP = RUN_RULE + 0.5 + 8;
/** One footer row. */
const FOOTER_ROW = 10;
/** The widest logo the header (and, scaled, the running header) takes. */
const LOGO_MAX_W = 110;

const A4_SHORT = 595.28;
const A4_LONG = 841.89;

/**
 * The boxes (points) the headers print pictures in: the project's picture and the company's logo.
 * The routes size pictures for them (the picture library's toDocumentPicture: ≤ 200 dpi).
 */
export const PDF_PICTURE_BOX = {
  mark: { width: MARK, height: MARK },
  logo: { width: LOGO_MAX_W, height: MARK },
} as const;

/** The room between the last line of text and the footer's rule. */
const FOOTER_GAP = 8;

/**
 * A top-down position moved to the nearest half point of the printed page (crisp hairlines): pdfkit
 * draws under a flip of the page's height, so the printed edge is `pageHeight − v`.
 */
const snap = (v: number, pageHeight: number) => pageHeight - Math.round((pageHeight - v) * 2) / 2;

/**
 * The built-in logo for PDFs: assets/logo-pdf.png, the brand logo flattened onto white (no alpha
 * channel, so pdfkit embeds it synchronously) at 200 dpi for the 26 pt header, found next to the
 * server or the source.
 */
let logoCache: Buffer | null | undefined;
function companyLogo(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  const candidates = [resolve(process.cwd(), 'assets', 'logo-pdf.png'), resolve(__dirname, '../../assets/logo-pdf.png'), resolve(__dirname, '../../../assets/logo-pdf.png')];
  const found = candidates.find((c) => existsSync(c));
  logoCache = found ? readFileSync(found) : null;
  return logoCache;
}

/** Parse "#RRGGBB" (or an [r,g,b] 0-1 triple) into an RGB 0-1 triple. */
export function hexToRgb(input: string | RGB, fallback: RGB = INK): RGB {
  if (Array.isArray(input)) return input;
  const m = /^#?([0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
/** Darken an RGB toward black by `amount` (0-1). */
function darken(c: RGB, amount: number): RGB {
  return [c[0] * (1 - amount), c[1] * (1 - amount), c[2] * (1 - amount)];
}
/** RGB 0-1 triple → "#rrggbb" for pdfkit. */
function toHex(c: RGB): string {
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

/** 'start' = left for left-to-right paragraphs, right for right-to-left (Arabic) ones. */
export type TextAlign = 'start' | 'left' | 'right' | 'center';

/** Paragraph direction; when omitted it follows the first strong character (UAX #9). */
export type TextDirection = 'ltr' | 'rtl';

export interface TextOptions {
  bold?: boolean;
  size?: number;
  color?: RGB;
  /** Indent from the starting edge (left for LTR text, right for RTL text), in points. */
  indent?: number;
  /** Extra vertical space added after the block, in points. */
  gap?: number;
  align?: TextAlign;
  /** Force the paragraph direction (e.g. to align an attribution line with the note above it). */
  direction?: TextDirection;
  /** Accepted for older callers; since 1.23.10 every PDF is set in one font family. */
  family?: 'text' | 'display';
  /**
   * Inset from the left edge whatever the paragraph's direction, in points: a block nested in a
   * left-to-right layout, such as a reply under a comment. An Arabic line still ends at the right edge.
   */
  inset?: number;
  /** A thin rule in this colour beside each line, inside the inset (a reply's thread line). */
  bar?: RGB;
}

/** A picture with the words under it, for imageGrid. */
export interface GridPicture {
  /** A picture prepared with prepareImage. */
  image: Buffer;
  caption: string;
}

/** What every page's footer says (1.23.10, owner): the company, when it was printed and by whom, and the page number. */
export interface PdfFooter {
  /** The company's name (bold, on the left). */
  company?: string;
  /** "Printed 10 Nov 2026, 14:05 by Name" (see printedLine). */
  printed?: string;
  /** More lines under them (website and support address, postal address, "Shared with you through …"); wrapped, never cut. */
  extra?: string[];
}

export type PageOrientation = 'portrait' | 'landscape';

export interface PdfDocumentOptions {
  /** The footer on every page. */
  footer?: PdfFooter;
  /** Brand palette; hex strings or RGB triples. Drives headings, rules, labels and the footer. */
  palette?: Partial<Record<'ink' | 'muted' | 'brand' | 'line', string | RGB>>;
  /** Document title stored in the PDF metadata (shown in viewers' title bars and tabs); the running header's words when runningTitle is not given. */
  title?: string;
  /** A4 portrait (the default) or landscape for the first page; see orient() for a landscape section. */
  orientation?: PageOrientation;
  /** Shown in the slim running header at the top of every page after the first (default: the title). */
  runningTitle?: string;
  /**
   * The company's own logo (a picture the PDF can print, e.g. from readProjectPicture), on the right of
   * the header and the running header. Null or left out (or one that can't be printed): the built-in logo.
   */
  logo?: Buffer | null;
  /** Accepted for older callers; since 1.23.10 every PDF is set on one standard. */
  density?: PdfDensity;
}

/** Accepted for older callers (see PdfDocumentOptions.density). */
export type PdfDensity = 'regular' | 'compact';

/** A "Label: value" row; a third entry makes the value a link to that address (only the label is shown). */
export type KeyValueRow = readonly [label: string, value: string, href?: string];

/** Where the last line of a paragraph, list item or formatted text was drawn (for aside()). */
interface LastLine {
  page: number;
  baseline: number;
  /** The left and right ends of its words. */
  x0: number;
  x1: number;
  rtl: boolean;
  /** The cursor just after it: an aside only joins the line while nothing else has been drawn since. */
  after: number;
}

/** A picture pdfkit has opened: embedded once however often it is drawn; its size in pixels. */
interface OpenedImage {
  width: number;
  height: number;
}

/** A project's mark: its picture, else its icon, else its initials, on its colour. */
interface ProjectMark {
  image: OpenedImage | null;
  icon: readonly string[] | null;
  initials: string;
  color: RGB;
}

/** The biggest box (points) that holds a `width`×`height` picture inside `maxW`×`maxH`, keeping its shape. */
function fitBox(width: number, height: number, maxW: number, maxH: number): { w: number; h: number } {
  const k = Math.min(maxW / width, maxH / height);
  return { w: width * k, h: height * k };
}

/** A small pill on the right of a header ("DRAFT", "FINAL"). */
export interface HeaderBadge {
  text: string;
  tone?: 'muted' | 'success' | 'warning';
}

export interface StatTile {
  label: string;
  value: string;
  /** A small note beside the value (e.g. a percentage). */
  note?: string;
  tone?: 'brand' | 'danger' | 'success' | 'warning' | 'muted';
  /** 1.23.10: the colour-scheme tones to set it in (a status's, a priority's); else from `tone`. */
  colors?: Tone;
}

export interface BarItem {
  label: string;
  value: number;
  color?: string | RGB;
}

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string | RGB;
}

export interface TableColumn {
  /** Header text. */
  header: string;
  /** 'auto' (default): numbers right-aligned, dates centred, text by its own direction. */
  align?: 'auto' | 'left' | 'right' | 'center';
  /** Keep each cell on one line when the width allows (dates, numbers, codes). */
  nowrap?: boolean;
}

/** Room between a table cell's edge and its text, left and right (points). */
export const TABLE_PAD_X = 5;
/** Room above and below a table cell's text (points). */
const TABLE_PAD_Y = 2.5;

/** The width between the side margins of an A4 page in this orientation, in points. */
export function contentWidthOf(orientation: PageOrientation = 'portrait'): number {
  return (orientation === 'landscape' ? A4_LONG : A4_SHORT) - SIDE * 2;
}

const NUMERIC = /^[-+]?[\d,]*\.?\d+%?$/;
/** "12 Nov 2026", "3 Dec", "1 Oct 2026, 13:15", "12 Nov 2026 · Overdue". */
const DATE = /^\d{1,2} [A-Z][a-z]{2}(?: \d{4})?(?:, \d{1,2}:\d{2})?(?: · .+)?$/;
/** The date itself at the start of such a cell. */
const DATE_PART = /^\d{1,2} [A-Z][a-z]{2}(?: \d{4})?(?:, \d{1,2}:\d{2})?/;

/** A block of formatted text for richBlocks: a paragraph, a heading or a list item. */
export interface PdfRichBlock {
  kind: 'paragraph' | 'heading' | 'item';
  runs: StyledRun[];
  /** A list item's marker: '•' (drawn as a small square) or a number such as "2.". */
  marker?: string;
  /** How deeply a list item is nested (0 = top). */
  level?: number;
}

/** The bullet marker of lists (drawn as a small square in the brand colour). */
export const BULLET = '•';

/** Every method and property returns itself: drawing while a section is only measured goes nowhere. */
const SINK: PDFKit.PDFDocument = new Proxy(function sink() {}, {
  get: (_target, prop) => (prop === 'then' ? undefined : SINK),
  apply: () => SINK,
}) as unknown as PDFKit.PDFDocument;

/** A footer laid out for one page width. */
interface FooterLayout {
  /** The first row: the company (left), when printed (centre, or after the company), the page number (right). */
  company: TextLine | null;
  printed: TextLine | null;
  /** The printed line goes after the company on the left (no room to centre it), or on a row of its own. */
  printedAt: 'centre' | 'after' | 'own';
  /** The rows after the first: lines of the extras (and the printed line when it has its own row). */
  rows: Array<{ line: TextLine; bold?: boolean }>;
  /** How much of the page bottom the footer takes, its bottom margin included. */
  band: number;
}

export class PdfDocument {
  /** The side margin (14 mm). */
  readonly margin = SIDE;

  private readonly pdfkit: PDFKit.PDFDocument;
  /** The orientation of the current page (or of the page that will be added next). */
  private orientation: PageOrientation;
  /** Each page added so far, in order: its orientation. */
  private readonly orients: PageOrientation[] = [];
  /** The current page, counted from 1 — added already, or waiting for the first thing drawn on it. */
  private pageNo = 1;
  /** The current page is not added yet: nothing has been drawn on it (so it can never be left blank). */
  private pending = true;
  /** Top-down cursor (pdfkit coordinates): where the next block starts. */
  private y = TOP;
  /** > 0 while a section is measured: nothing is drawn. */
  private dry = 0;
  private built: Buffer | null = null;
  private builtPages = 0;

  /** Resolved brand palette used by headings, rules, labels and the footer. */
  private readonly pal: { ink: RGB; muted: RGB; brand: RGB; line: RGB };
  /** The company's own logo, opened once (null: the built-in logo). */
  private readonly companyMark: OpenedImage | null;
  /** The built-in logo, opened once when first drawn. */
  private builtInLogo: OpenedImage | null | undefined;
  /** The project's mark from the header, drawn small in the running header. */
  private projectMark: ProjectMark | null = null;
  /** The brand mark from a product header (no project), drawn small in the running header. */
  private brandMark: { from?: RGB; to?: RGB } | null = null;
  private readonly footers = new Map<PageOrientation, FooterLayout>();
  private lastLine: LastLine | null = null;

  constructor(private readonly opts: PdfDocumentOptions = {}) {
    this.orientation = opts.orientation ?? 'portrait';
    const p = opts.palette ?? {};
    this.pal = {
      ink: p.ink ? hexToRgb(p.ink, INK) : INK,
      muted: p.muted ? hexToRgb(p.muted, MUTED) : MUTED,
      brand: p.brand ? hexToRgb(p.brand, BRAND) : BRAND,
      line: p.line ? hexToRgb(p.line, LINE) : LINE,
    };
    this.pdfkit = new PDFDocument({
      size: 'A4',
      layout: this.orientation,
      margin: 0,
      autoFirstPage: false, // a page is added when the first thing is drawn on it
      bufferPages: true, // footers ("Page N of M") are drawn once the page count is known
      displayTitle: Boolean(opts.title),
      info: { ...(opts.title ? { Title: opts.title } : {}), Creator: 'MICO360 Tasks', Producer: 'MICO360 Tasks' },
    });
    registerPdfFonts(this.pdfkit);
    this.companyMark = opts.logo ? this.openImage(opts.logo) : null;
  }

  // ── Pages ────────────────────────────────────────────────────────────────────────────────────

  /** The width of the current page. */
  get pageWidth(): number {
    return this.orientation === 'landscape' ? A4_LONG : A4_SHORT;
  }

  /** The height of the current page. */
  get pageHeight(): number {
    return this.orientation === 'landscape' ? A4_SHORT : A4_LONG;
  }

  /** Where the next block starts, in points from the top of the page. */
  get cursor(): number {
    return this.y;
  }

  /** Pages so far (the final count once built). */
  get pageCount(): number {
    return this.built ? this.builtPages : this.orients.length;
  }

  /** Room left on the current page, in points. */
  get remaining(): number {
    return this.contentBottom - this.y;
  }

  private get contentWidth(): number {
    return this.pageWidth - SIDE * 2;
  }

  private get contentBottom(): number {
    return this.pageHeight - this.footerLayout(this.orientation).band - FOOTER_GAP;
  }

  /** Where text starts on this page: the top margin on the first page, under the running header after it. */
  private get pageTop(): number {
    return this.pageNo === 1 ? TOP : CONTINUATION_TOP;
  }

  private get atTop(): boolean {
    return this.y <= this.pageTop + 0.5;
  }

  /** The page drawing goes on (added now if it is still waiting); nothing while a section is measured. */
  private get ink(): PDFKit.PDFDocument {
    if (this.dry) {
      this.pending = false;
      return SINK;
    }
    if (this.pending) {
      this.pdfkit.addPage({ size: 'A4', layout: this.orientation, margin: 0 });
      this.orients.push(this.orientation);
      this.pending = false;
    }
    return this.pdfkit;
  }

  /** Move on to a new page — added only when something is drawn on it, so none is ever left blank. */
  private newPage(): void {
    if (!this.pending) {
      this.pageNo++;
      this.pending = true;
    }
    this.y = this.pageTop;
    this.lastLine = null;
  }

  /**
   * Go on in this orientation: a landscape section for a table too wide for a portrait page, and
   * back to portrait after it. Starts a new page unless nothing is on the current one yet.
   */
  orient(orientation: PageOrientation): this {
    if (orientation === this.orientation) return this;
    if (!this.pending) this.newPage();
    this.orientation = orientation;
    this.y = this.pageTop;
    return this;
  }

  /**
   * Whether a table needs a landscape page: its columns' longest words don't fit across a portrait
   * page even with the type at its smallest (7.5 pt). Owner (10 Nov): documents stay portrait; a
   * table that won't fit turns landscape by itself, and its text never shrinks below a readable size.
   */
  static needsLandscape(columns: TableColumn[], rows: ReadonlyArray<ReadonlyArray<string>>, options: { size?: number } = {}): boolean {
    if (columns.length === 0) return false;
    return !fitColumns(measureTable(columns, rows).measured, contentWidthOf('portrait'), { size: options.size ?? TYPE.table, minSize: TYPE.tableMin, padX: TABLE_PAD_X }).fits;
  }

  /** Keep the next `height` points together: start a new page if they don't fit here. */
  keepTogether(height: number): this {
    this.ensure(height);
    return this;
  }

  /** Start a new page if `height` doesn't fit here (never loops on an over-tall block at a page top). */
  private ensure(height: number): void {
    if (this.y + height > this.contentBottom && !this.atTop) this.newPage();
  }

  /**
   * A section drawn by `draw`: when it takes less than a third of a page, it is kept whole (moved to
   * the next page rather than split); a bigger one starts where it is. `draw` is run once to measure
   * (nothing drawn) and once to draw, so it must only draw.
   */
  section(draw: () => void): this {
    const height = this.measure(draw);
    const page = this.contentBottom - CONTINUATION_TOP;
    if (height <= page / 3 && this.y + height > this.contentBottom) this.newPage();
    draw();
    return this;
  }

  /** How tall `draw` is from just under the top of a fresh page (Infinity when it runs onto another page); nothing is drawn. */
  private measure(draw: () => void): number {
    const saved = { y: this.y, pageNo: this.pageNo, pending: this.pending, lastLine: this.lastLine, orientation: this.orientation };
    this.dry++;
    try {
      this.pageNo = Math.max(2, this.pageNo);
      this.pending = true;
      this.y = CONTINUATION_TOP + 1;
      const start = this.pageNo;
      draw();
      return this.pageNo === start ? this.y - (CONTINUATION_TOP + 1) : Number.POSITIVE_INFINITY;
    } finally {
      this.dry--;
      this.y = saved.y;
      this.pageNo = saved.pageNo;
      this.pending = saved.pending;
      this.lastLine = saved.lastLine;
      this.orientation = saved.orientation;
    }
  }

  // ── Pictures ─────────────────────────────────────────────────────────────────────────────────

  /** A picture opened for drawing (from prepareImage's rules), or null when it can't be printed. */
  private openImage(image: Buffer): OpenedImage | null {
    const printable = printableImage(image);
    if (!printable) return null;
    try {
      const opened = (this.pdfkit as unknown as { openImage(src: Buffer): OpenedImage }).openImage(printable);
      return opened.width > 0 && opened.height > 0 ? opened : null;
    } catch {
      return null;
    }
  }

  /** Draws an opened picture fitted into `w`×`h` at (x, top) — the same object every time, so it is embedded once. */
  private drawOpened(img: OpenedImage, x: number, top: number, w: number, h: number, doc: PDFKit.PDFDocument = this.ink): void {
    (doc as unknown as { image(src: OpenedImage, x: number, y: number, o: { width: number; height: number }): unknown }).image(img, x, top, { width: w, height: h });
  }

  /** The company's logo, else the built-in one (null when even that is missing). */
  private logo(): OpenedImage | null {
    if (this.companyMark) return this.companyMark;
    if (this.builtInLogo === undefined) {
      const file = companyLogo();
      this.builtInLogo = file ? this.openImage(file) : null;
    }
    return this.builtInLogo;
  }

  /** The logo at the right end of a row `h` high starting at `top` (at most `maxW` wide); returns its width (0 without one). */
  private drawLogo(top: number, h: number, maxW: number, doc: PDFKit.PDFDocument = this.ink): number {
    const img = this.logo();
    const right = this.margin + this.contentWidth;
    if (!img) {
      this.logoMark(right - h, this.pageHeight - top - h, h, undefined, undefined, doc);
      return h;
    }
    const box = fitBox(img.width, img.height, maxW, h);
    this.drawOpened(img, right - box.w, top + (h - box.h) / 2, box.w, box.h, doc);
    return box.w;
  }

  /**
   * A picture as this document can print it: a JPEG or PNG (a see-through PNG flattened onto white,
   * see printableImage) that pdfkit can read; null for anything else (WebP, GIF, a damaged file).
   */
  prepareImage(image: Buffer): Buffer | null {
    const printable = printableImage(image);
    if (!printable) return null;
    try {
      // pdfkit reads the picture's header here (its typings leave openImage out).
      (this.pdfkit as unknown as { openImage(src: Buffer): unknown }).openImage(printable);
      return printable;
    } catch {
      return null;
    }
  }

  // ── Drawing primitives ───────────────────────────────────────────────────────────────────────

  /** Width of a string in points at the given size/weight (shaped, so Arabic joins are measured correctly). */
  textWidth(text: string, size: number, bold = false): number {
    return measureText(text, size, bold);
  }

  private fillRect(x: number, top: number, w: number, h: number, color: RGB, doc: PDFKit.PDFDocument = this.ink): void {
    doc.rect(x, top, w, h).fill(toHex(color));
  }

  /** A crisp 0.5 pt hairline across the content width, on a half-point position. */
  private hairline(top: number, color: RGB = this.pal.line, doc: PDFKit.PDFDocument = this.ink, width = this.contentWidth): void {
    this.fillRect(this.margin, snap(top, this.pageHeight), width, 0.5, color, doc);
  }

  /** Draw a laid-out line on `baseline`, aligned inside [left, left + width]. Returns where its left end is. */
  private placeLine(line: TextLine, left: number, width: number, baseline: number, size: number, color: RGB, align: TextAlign, doc: PDFKit.PDFDocument = this.ink): number {
    const effective = align === 'start' ? (line.rtl ? 'right' : 'left') : align;
    const x = effective === 'right' ? left + width - line.width : effective === 'center' ? left + (width - line.width) / 2 : left;
    drawTextLine(doc, line, x, baseline, size, toHex(color));
    return x;
  }

  /** Remember the line just drawn (its baseline and ends) as the one an aside() may join. */
  private noteLine(line: TextLine, x: number, baseline: number): void {
    this.lastLine = { page: this.pageNo, baseline, x0: x, x1: x + line.width, rtl: line.rtl, after: this.y };
  }

  /** Draw the brand logo mark: a rounded gradient tile with a white check + progress dot. `y` is the tile's bottom edge in PDF (bottom-up) space. */
  logoMark(x: number, y: number, size: number, from?: RGB, to?: RGB, doc: PDFKit.PDFDocument = this.ink): this {
    const c0 = from ?? this.pal.brand;
    const c1 = to ?? darken(this.pal.brand, 0.4);
    const top = this.pageHeight - y - size;
    const r = size * 0.22;
    const grad = doc.linearGradient(x, top, x, top + size);
    grad.stop(0, toHex(c0)).stop(1, toHex(c1));
    doc.save();
    doc.roundedRect(x, top, size, size, r).clip();
    doc.rect(x, top, size, size).fill(grad);
    doc.restore();
    // White check mark (stroked, round caps).
    doc
      .save()
      .lineWidth(size * 0.1)
      .lineCap('round')
      .lineJoin('round')
      .moveTo(x + size * 0.27, top + size * 0.5)
      .lineTo(x + size * 0.43, top + size * 0.66)
      .lineTo(x + size * 0.72, top + size * 0.36)
      .stroke(toHex(WHITE))
      .restore();
    // Small white progress node at the top-right.
    doc.circle(x + size * 0.72, top + size * 0.26, size * 0.07).fill(toHex(WHITE));
    return this;
  }

  /** A project's mark `s` points square at (x, top): its picture on white, else its icon or initials on its colour. */
  private drawMark(mark: ProjectMark, x: number, top: number, s: number, doc: PDFKit.PDFDocument = this.ink): void {
    const r = s * 0.22;
    doc.save();
    doc.roundedRect(x, top, s, s, r).clip();
    doc.rect(x, top, s, s).fill(toHex(mark.image ? WHITE : mark.color));
    if (mark.image) {
      // The picture fills its tile (the rounded corners clip it), as tall as the company's logo.
      const box = fitBox(mark.image.width, mark.image.height, s, s);
      this.drawOpened(mark.image, x + (s - box.w) / 2, top + (s - box.h) / 2, box.w, box.h, doc);
    }
    doc.restore();
    if (mark.image) {
      doc.save().lineWidth(0.5).roundedRect(x + 0.25, top + 0.25, s - 0.5, s - 0.5, r).stroke(toHex(this.pal.line)).restore();
    } else if (mark.icon?.length) {
      // The icon at half the tile, as the app draws it: round-capped outlines in white.
      const k = s / 2 / 24;
      doc.save().translate(x + s / 4, top + s / 4).scale(k);
      for (const d of mark.icon) doc.path(d).lineWidth(1.9).lineCap('round').lineJoin('round').stroke(toHex(WHITE));
      doc.restore();
    } else {
      // The initials, as large as reads well on the tile, never under the smallest type.
      const size = Math.max(TYPE.min, (17 * s) / 46);
      const initials = layoutText(mark.initials.slice(0, 3).toUpperCase(), { size, bold: true })[0];
      if (initials) drawTextLine(doc, initials, x + (s - initials.width) / 2, top + s / 2 + size * 0.36, size, toHex(WHITE));
    }
  }

  // ── Headers ──────────────────────────────────────────────────────────────────────────────────

  /**
   * A product header (a document about no project, such as a standalone meeting's minutes): the
   * brand mark, the eyebrow, product name and tagline, the badge, the company logo.
   */
  brandHeader(opts: { title: string; subtitle?: string; eyebrow?: string; from?: RGB; to?: RGB; badge?: HeaderBadge }): this {
    this.brandMark = { from: opts.from, to: opts.to };
    return this.band({ mark: { brand: this.brandMark }, eyebrow: opts.eyebrow, title: opts.title, subtitle: opts.subtitle, badge: opts.badge });
  }

  /**
   * A header for a document about one project: its picture when this document can print it (see
   * prepareImage — a see-through one is set on white), else its icon (24×24 outline paths) or its
   * initials on its colour; the eyebrow (what the document is) with the project's code, its name, an
   * optional badge, the company logo on the right, and a thin brand rule beneath. The same mark is
   * drawn small in the running header of every later page.
   */
  identityHeader(opts: { image?: Buffer | null; icon?: readonly string[] | null; initials: string; color?: RGB; title: string; subtitle?: string; eyebrow?: string; badge?: HeaderBadge }): this {
    this.projectMark = { image: opts.image ? this.openImage(opts.image) : null, icon: opts.icon?.length ? opts.icon : null, initials: opts.initials, color: opts.color ?? this.pal.brand };
    return this.band({ mark: { project: this.projectMark }, eyebrow: opts.eyebrow, title: opts.title, subtitle: opts.subtitle, badge: opts.badge });
  }

  /**
   * A report's header (Reports, Management, MICO AI): the title (15.5 pt) and a subtitle in the
   * brand colour, detail lines (filters, period) under them, the company logo on the right, a thin
   * brand rule beneath.
   */
  reportHeader(opts: { title: string; subtitle?: string; details?: string[] }): this {
    return this.band({ mark: null, title: opts.title, titleSize: TYPE.title, lead: opts.subtitle, details: opts.details });
  }

  /**
   * The header band: [mark] [eyebrow · subtitle / title / lead / details] … [badge] [logo], at least
   * 26 pt tall, then a thin brand rule. A line too long for the room shrinks a little, then wraps —
   * never cut; the band grows to hold it.
   */
  private band(o: {
    mark: { project: ProjectMark } | { brand: { from?: RGB; to?: RGB } } | null;
    eyebrow?: string;
    title: string;
    titleSize?: number;
    subtitle?: string;
    lead?: string;
    details?: string[];
    badge?: HeaderBadge;
  }): this {
    const top = this.y;
    // The right side first: the logo at the edge, then the badge.
    const logoW = this.drawLogo(top, MARK, LOGO_MAX_W);
    let right = this.margin + this.contentWidth - logoW - 10;
    if (o.badge) {
      const size = TYPE.label;
      const line = layoutText(o.badge.text.toUpperCase(), { size, bold: true })[0]!;
      const tone = o.badge.tone === 'success' ? SUCCESS : o.badge.tone === 'warning' ? WARNING : this.pal.muted;
      const w = line.width + 14;
      const h = 15;
      const bx = right - w;
      const by = top + (MARK - h) / 2;
      this.ink.save().roundedRect(bx, by, w, h, h / 2).fill(toHex(mix(tone, WHITE, 0.86))).restore();
      this.ink.save().lineWidth(0.5).roundedRect(bx, by, w, h, h / 2).stroke(toHex(tone)).restore();
      drawTextLine(this.ink, line, bx + 7, by + h / 2 + size * 0.36, size, toHex(darken(tone, 0.2)));
      right = bx - 10;
    }
    // The mark on the left.
    let tx = this.margin;
    if (o.mark) {
      if ('project' in o.mark) this.drawMark(o.mark.project, tx, top, MARK);
      else this.logoMark(tx, this.pageHeight - top - MARK, MARK, o.mark.brand.from, o.mark.brand.to);
      tx += MARK + 8;
    }
    const tw = Math.max(80, right - tx);
    const fit = (text: string, size: number, min: number, bold: boolean, color: RGB) => {
      let sz = size;
      while (sz > min && measureText(text, sz, bold) > tw) sz -= 0.5;
      return { size: sz, color, bold, lines: layoutText(text, { size: sz, bold, maxWidth: tw }) };
    };
    type Block = ReturnType<typeof fit> & { beside?: ReturnType<typeof fit> };
    const blocks: Block[] = [];
    if (o.eyebrow) {
      const eyebrow: Block = fit(o.eyebrow.toUpperCase(), TYPE.label, TYPE.label, true, this.pal.brand);
      // The subtitle (the project's code, number…) follows the eyebrow on its line when it fits there.
      if (o.subtitle) {
        const sub = fit(o.subtitle, TYPE.label, TYPE.label, false, this.pal.muted);
        const room = tw - (eyebrow.lines[0]?.width ?? 0) - 12;
        if (eyebrow.lines.length === 1 && sub.lines.length === 1 && sub.lines[0]!.width <= room) eyebrow.beside = sub;
      }
      blocks.push(eyebrow);
    }
    blocks.push(fit(o.title, o.titleSize ?? TYPE.heading, o.titleSize ? TYPE.heading : TYPE.body, true, this.pal.ink));
    if (o.subtitle && !blocks[0]?.beside) blocks.push(fit(o.subtitle, TYPE.label, TYPE.label, false, this.pal.muted));
    if (o.lead) blocks.push(fit(o.lead, TYPE.body, TYPE.small, true, this.pal.brand));
    for (const d of o.details ?? []) blocks.push(fit(d, TYPE.small, TYPE.small, false, this.pal.muted));
    // Tight lines for these one-line labels; Arabic keeps its taller box.
    const boxOf = (ln: TextLine, size: number) => (ln.arabic ? lineBox(ln, size) : { height: size * 1.28, ascent: size * 0.97 });
    const total = blocks.reduce((h, b) => h + b.lines.reduce((t, ln) => t + boxOf(ln, b.size).height, 0), 0);
    let y = top + Math.max(0, (MARK - total) / 2);
    for (const b of blocks) {
      for (const ln of b.lines) {
        const box = boxOf(ln, b.size);
        drawTextLine(this.ink, ln, tx, y + box.ascent, b.size, toHex(b.color));
        if (b.beside) {
          const dot = layoutText('·', { size: b.size })[0]!;
          drawTextLine(this.ink, dot, tx + ln.width + 4, y + box.ascent, b.size, toHex(this.pal.muted));
          drawTextLine(this.ink, b.beside.lines[0]!, tx + ln.width + 4 + dot.width + 4, y + box.ascent, b.beside.size, toHex(b.beside.color));
        }
        y += box.height;
      }
    }
    const bottom = Math.max(top + MARK, y);
    // A thin brand rule under the band.
    this.y = Math.round(bottom + 5);
    this.fillRect(this.margin, this.y, this.contentWidth, 1, this.pal.brand);
    this.y += 1 + 8;
    this.lastLine = null;
    return this;
  }

  /**
   * The document's own title under the header (a task's, a meeting's, an inspection's): 15.5 pt,
   * with its number (a task's key) just above it in 9 pt. A long title wraps (never cut).
   */
  documentTitle(title: string, options: { key?: string; direction?: TextDirection; size?: number } = {}): this {
    if (options.key) this.text(options.key, { bold: true, size: 9, color: this.pal.brand, direction: 'ltr' });
    this.text(title, { bold: true, size: Math.min(TYPE.title, Math.max(12, options.size ?? TYPE.title)), color: this.pal.ink, direction: options.direction, gap: PDF_STANDARD.space.m });
    return this;
  }

  /**
   * A heading that opens a part of the document ("Final Minutes of Meeting", "Meeting record"): its
   * title in the brand colour over a thin brand rule, kept with what follows it.
   */
  partBand(title: string, options: { topGap?: number; keepWith?: number } = {}): this {
    const size = TYPE.part;
    this.spacer(options.topGap ?? 12);
    this.ensure(this.textHeight(title, { bold: true, size }) + 9 + Math.max(40, options.keepWith ?? 0));
    this.text(title, { bold: true, size, color: this.pal.brand });
    this.y += 2;
    this.fillRect(this.margin, Math.round(this.y), this.contentWidth, 1, this.pal.brand);
    this.y = Math.round(this.y) + 1 + 6;
    return this;
  }

  /**
   * One line of status on a tinted strip — e.g. "FINAL · Approved by … on …" in green, or
   * "DRAFT · Not yet approved" in amber. Wraps when long.
   */
  statusStrip(text: string, tone: 'success' | 'warning' | 'muted' = 'muted'): this {
    const color = tone === 'success' ? SUCCESS : tone === 'warning' ? WARNING : this.pal.muted;
    // One slim line: a faint tint with an edge in the tone, the words a shade darker for contrast.
    const size = TYPE.small;
    const lines = layoutText(text, { size, bold: true, maxWidth: this.contentWidth - 18 });
    const padY = 3;
    const h = lines.reduce((t, ln) => t + lineBox(ln, size).height, 0) + padY * 2;
    this.ensure(h + 6);
    const top = this.y;
    this.fillRect(this.margin, top, this.contentWidth, h, mix(color, WHITE, 0.9));
    this.fillRect(this.margin, top, 2, h, color);
    let y = top + padY;
    for (const ln of lines) {
      const box = lineBox(ln, size);
      this.placeLine(ln, this.margin + 9, this.contentWidth - 18, y + box.ascent, size, darken(color, 0.2), 'start');
      y += box.height;
    }
    this.y = top + h + 6;
    return this;
  }

  /** A heading inside a part: bold ink, no rule, kept with the start of what follows. */
  subheading(text: string, options: { topGap?: number; keepWith?: number } = {}): this {
    const size = TYPE.subheading;
    this.spacer(options.topGap ?? 6);
    this.ensure(size * 1.6 + Math.max(28, options.keepWith ?? 0));
    this.text(text, { bold: true, size, color: this.pal.ink, gap: 2 });
    return this;
  }

  /** The room subheading() with these options keeps together (its gap, its line and what it keeps with it): a heading above it keeps this much. */
  subheadingRoom(options: { topGap?: number; keepWith?: number } = {}): number {
    return (options.topGap ?? 6) + TYPE.subheading * 1.6 + Math.max(28, options.keepWith ?? 0);
  }

  /** The height text() would take for this paragraph (its gap included), in points. */
  textHeight(content: string, options: TextOptions = {}): number {
    const size = options.size ?? TYPE.body;
    const width = this.contentWidth - (options.inset ?? 0) - (options.indent ?? 0);
    const lines = layoutText(content, { size, bold: options.bold ?? false, maxWidth: width, direction: options.direction });
    return lines.reduce((h, ln) => h + lineBox(ln, size).height, 0) + (options.gap ?? 0);
  }

  /**
   * "Label: value" pairs in two columns, each with its own label width; values wrap within their
   * column. A row with an address (see KeyValueRow) shows its value as a link to it. Kept together
   * on one page.
   */
  keyValueColumns(left: ReadonlyArray<KeyValueRow>, right: ReadonlyArray<KeyValueRow>, options: { size?: number } = {}): this {
    const size = options.size ?? TYPE.data;
    const gutter = 16;
    const colW = (this.contentWidth - gutter) / 2;
    const columns = [left, right];
    const laid = columns.map((col) => {
      const labels = col.map(([label]) => layoutText(label, { size, bold: true })[0]!);
      const labelW = Math.max(0, ...labels.map((l) => l.width)) + size * 0.9;
      const rows = col.map(([, value, href], i) => {
        const values = href ? layoutStyledText([{ text: value || '—', href }], { size, maxWidth: colW - labelW }) : layoutText(value || '—', { size, maxWidth: colW - labelW });
        const boxes = values.map((ln, j) => lineBox(ln, size, ln.arabic || (j === 0 && labels[i]!.arabic)));
        return { label: labels[i]!, values, boxes, height: boxes.reduce((h, b) => h + b.height, 0) };
      });
      return { labelW, rows, height: rows.reduce((h, r) => h + r.height, 0) };
    });
    this.ensure(Math.max(...laid.map((c) => c.height)));
    const top = this.y;
    laid.forEach((col, c) => {
      const left = this.margin + c * (colW + gutter);
      let y = top;
      for (const row of col.rows) {
        row.values.forEach((ln, j) => {
          const box = row.boxes[j]!;
          const baseline = y + box.ascent;
          if (j === 0) this.placeLine(row.label, left, col.labelW, baseline, size, this.pal.muted, 'left');
          this.placeLine(ln, left + col.labelW, colW - col.labelW, baseline, size, this.pal.ink, row.values.length === 1 ? 'left' : 'start');
          y += box.height;
        });
      }
    });
    this.y = top + Math.max(...laid.map((c) => c.height));
    return this;
  }

  /** Add empty vertical space (points). At the top of a page, or at a page break, the space is dropped. */
  spacer(height: number): this {
    if (this.atTop) return this;
    if (this.y + height > this.contentBottom) this.newPage();
    else this.y += height;
    return this;
  }

  /** A flowing paragraph; honors embedded "\n", wraps to the content width, aligns RTL paragraphs right. */
  text(content: string, options: TextOptions = {}): this {
    const size = options.size ?? TYPE.body;
    const width = this.contentWidth - (options.inset ?? 0) - (options.indent ?? 0);
    return this.flowLines(layoutText(content, { size, bold: options.bold ?? false, maxWidth: width, direction: options.direction }), size, options);
  }

  /** A flowing paragraph of formatted runs (bold, italic, underlined, highlighted, links), laid out as text() lays out plain text. */
  styledText(runs: StyledRun[], options: TextOptions = {}): this {
    const size = options.size ?? TYPE.body;
    const width = this.contentWidth - (options.inset ?? 0) - (options.indent ?? 0);
    return this.flowLines(layoutStyledText(runs, { size, bold: options.bold ?? false, maxWidth: width, direction: options.direction }), size, options);
  }

  /** Draw laid-out lines down the page (see TextOptions for indent, inset and bar). */
  private flowLines(lines: TextLine[], size: number, options: TextOptions): this {
    const color = options.color ?? this.pal.ink;
    const indent = options.indent ?? 0;
    const left = this.margin + (options.inset ?? 0);
    const width = this.contentWidth - (options.inset ?? 0) - indent;
    let last: [TextLine, number, number] | null = null;
    for (const line of lines) {
      const box = lineBox(line, size);
      this.ensure(box.height);
      if (options.bar) this.fillRect(Math.max(this.margin, left - 10), this.y, 1.5, box.height, options.bar);
      const x = this.placeLine(line, line.rtl ? left : left + indent, width, this.y + box.ascent, size, color, options.align ?? 'start');
      last = [line, x, this.y + box.ascent];
      this.y += box.height;
    }
    if (options.gap) this.y += options.gap;
    if (last) this.noteLine(...last);
    return this;
  }

  /**
   * A small aside after the paragraph, list item or formatted text just drawn — an attribution
   * such as "Ada Lovelace · 09:05", muted and smaller than the text. It sits on that block's last
   * line, flush to the line's end edge (the right one; the left one when the line is right-to-left),
   * when there is room beside the words; otherwise on a short line of its own under them, at the
   * same edge. Something else drawn since that block: a line of its own.
   */
  aside(content: string, options: { size?: number; color?: RGB; direction?: TextDirection } = {}): this {
    const size = Math.max(TYPE.min, options.size ?? TYPE.small);
    const color = options.color ?? this.pal.muted;
    const prev = this.lastLine;
    const last = prev && prev.after === this.y && prev.page === this.pageNo ? prev : null;
    const rtl = options.direction ? options.direction === 'rtl' : (last?.rtl ?? false);
    const lines = layoutText(content, { size, maxWidth: this.contentWidth, direction: rtl ? 'rtl' : 'ltr' });
    const left = this.margin;
    const right = this.margin + this.contentWidth;
    const gap = 10;
    const one = lines.length === 1 ? lines[0]! : null;
    if (last && one && (rtl ? left + one.width + gap <= last.x0 : last.x1 + gap <= right - one.width)) {
      drawTextLine(this.ink, one, rtl ? left : right - one.width, last.baseline, size, toHex(color));
      return this;
    }
    lines.forEach((ln, i) => {
      const box = lineBox(ln, size);
      // Kept with the block it belongs to: a one-line aside right under it may reach into the gap
      // above the footer — never onto its rule — rather than sit alone at the top of a page.
      const overhang = i === 0 && last !== null && lines.length === 1 && this.y + box.height <= this.contentBottom + FOOTER_GAP - 2;
      if (!overhang) this.ensure(box.height);
      this.placeLine(ln, left, this.contentWidth, this.y + box.ascent, size, color, rtl ? 'left' : 'right');
      this.y += box.height;
    });
    this.lastLine = null;
    return this;
  }

  /**
   * A checklist item: a drawn box (filled with a white tick when done) and the item's words with a
   * hanging indent, wrapped in full. A right-to-left item has its box on the right. Done items are muted.
   */
  checkItem(content: string, done: boolean, options: { size?: number; direction?: TextDirection; indent?: number } = {}): this {
    const size = options.size ?? TYPE.body;
    const box = Math.round(size * 0.95 * 10) / 10;
    // 1.23.3: a sub-item sits further in (from the right for a right-to-left item).
    const indent = Math.max(0, Math.min(options.indent ?? 0, this.contentWidth / 3));
    const gutter = box + 7;
    const width = this.contentWidth - gutter - indent;
    const lines = layoutText(content, { size, maxWidth: width, direction: options.direction });
    const rtl = lines[0]?.rtl ?? false;
    lines.forEach((ln, i) => {
      const lb = lineBox(ln, size);
      this.ensure(lb.height);
      const baseline = this.y + lb.ascent;
      if (i === 0) {
        const bx = rtl ? this.pageWidth - this.margin - indent - box : this.margin + indent;
        const by = baseline - size * 0.78;
        if (done) {
          this.ink.save().roundedRect(bx, by, box, box, 2).fill(toHex(SUCCESS)).restore();
          this.ink
            .save()
            .lineWidth(box * 0.14)
            .lineCap('round')
            .lineJoin('round')
            .moveTo(bx + box * 0.24, by + box * 0.52)
            .lineTo(bx + box * 0.43, by + box * 0.7)
            .lineTo(bx + box * 0.77, by + box * 0.3)
            .stroke(toHex(WHITE))
            .restore();
        } else {
          this.ink.save().lineWidth(0.9).roundedRect(bx + 0.45, by + 0.45, box - 0.9, box - 0.9, 2).stroke(toHex(this.pal.muted)).restore();
        }
      }
      this.placeLine(ln, rtl ? this.margin : this.margin + indent + gutter, width, baseline, size, done ? this.pal.muted : this.pal.ink, 'start');
      this.y += lb.height;
    });
    this.y += 1.5;
    return this;
  }

  /**
   * Pictures in a grid (three to a row by default), each fitted into a framed box with its caption
   * under it, wrapped in full. A row is kept whole on one page. Pictures must come from prepareImage.
   */
  imageGrid(items: GridPicture[], options: { columns?: number; height?: number } = {}): this {
    const { cols, gap, w, h, size, capBox } = this.gridLayout(options);
    for (let r = 0; r < items.length; r += cols) {
      const row = items.slice(r, r + cols);
      const captions = row.map((it) => layoutText(it.caption, { size, maxWidth: w }));
      const rowH = h + 3 + Math.max(...captions.map((c) => c.length)) * capBox.height;
      this.ensure(rowH);
      const top = this.y;
      row.forEach((it, i) => {
        const x = this.margin + i * (w + gap);
        this.ink.save().roundedRect(x, top, w, h, 3).fill(toHex(mix(this.pal.line, WHITE, 0.7))).restore();
        this.ink.image(it.image, x + 2, top + 2, { fit: [w - 4, h - 4], align: 'center', valign: 'center' });
        this.ink.save().lineWidth(0.5).roundedRect(x, top, w, h, 3).stroke(toHex(this.pal.line)).restore();
        captions[i]!.forEach((ln, li) => this.placeLine(ln, x, w, top + h + 3 + li * capBox.height + capBox.ascent, size, this.pal.muted, 'start'));
      });
      this.y = top + rowH + gap;
    }
    return this;
  }

  /** The height of imageGrid()'s first row of these pictures (0 for none): a heading above the grid keeps this much. */
  imageGridFirstRowHeight(items: Pick<GridPicture, 'caption'>[], options: { columns?: number; height?: number } = {}): number {
    if (items.length === 0) return 0;
    const { cols, w, h, size, capBox } = this.gridLayout(options);
    const lines = items.slice(0, cols).map((it) => layoutText(it.caption, { size, maxWidth: w }).length);
    return h + 3 + Math.max(...lines) * capBox.height;
  }

  private gridLayout(options: { columns?: number; height?: number }) {
    const cols = options.columns ?? 3;
    const gap = 8;
    const w = (this.contentWidth - gap * (cols - 1)) / cols;
    const h = options.height ?? Math.round(w * 0.66);
    const size = TYPE.small;
    return { cols, gap, w, h, size, capBox: lineBox(null, size, true) };
  }

  /**
   * A section heading: 11 pt in the brand colour, with a hairline rule beneath. Kept with what
   * follows it — at least its first two lines, or `keepWith` points. `aside`: a short muted note (a
   * count, say) at the end of the heading's line, or under the rule when the line has no room for it.
   */
  heading(text: string, options: { size?: number; color?: RGB; topGap?: number; keepWith?: number; aside?: string } = {}): this {
    // One size for every section heading (a caller's bigger size is held to it).
    const size = Math.min(options.size ?? TYPE.heading, TYPE.heading);
    const ruleGap = 2;
    const after = 4;
    this.spacer(options.topGap ?? PDF_STANDARD.space.l);
    // Heading + rule + the start of what follows (at least two lines of text, or `keepWith` points).
    const own = this.textHeight(text, { bold: true, size });
    const below = ruleGap + 0.5 + after;
    const twoLines = lineBox(null, TYPE.body).height * 2;
    this.ensure(own + below + Math.max(twoLines, Math.min(options.keepWith ?? 0, this.contentBottom - CONTINUATION_TOP - own - below)));
    this.text(text, { bold: true, size, color: options.color ?? this.pal.brand });
    let aside = options.aside ?? null;
    const last = this.lastLine;
    if (aside && last) {
      const asideSize = TYPE.small;
      const ln = layoutText(aside, { size: asideSize, direction: last.rtl ? 'rtl' : 'ltr' })[0]!;
      const left = this.margin;
      const right = this.margin + this.contentWidth;
      if (last.rtl ? left + ln.width + 12 <= last.x0 : last.x1 + 12 <= right - ln.width) {
        drawTextLine(this.ink, ln, last.rtl ? left : right - ln.width, last.baseline, asideSize, toHex(this.pal.muted));
        aside = null;
      }
    }
    this.y += ruleGap;
    this.hairline(this.y);
    this.y += 0.5 + after;
    if (aside) this.text(aside, { size: TYPE.small, color: this.pal.muted, gap: 2 });
    this.lastLine = null;
    return this;
  }

  /**
   * A "Label: value" row; the value wraps under a hanging indent aligned past the label.
   * A one-line value sits right after its label; a wrapped right-to-left value is set
   * flush right like any Arabic paragraph.
   */
  keyValue(label: string, value: string, options: { size?: number } = {}): this {
    const size = options.size ?? TYPE.data;
    const labelLine = layoutText(label, { size, bold: true })[0]!;
    const labelWidth = labelLine.width + size * 0.9;
    const valueWidth = this.contentWidth - labelWidth;
    const valueLines = layoutText(value || '—', { size, maxWidth: valueWidth });
    valueLines.forEach((ln, i) => {
      // Label and first value line share one baseline, even when only one of them is Arabic.
      const box = lineBox(ln, size, ln.arabic || (i === 0 && labelLine.arabic));
      this.ensure(box.height);
      const baseline = this.y + box.ascent;
      if (i === 0) this.placeLine(labelLine, this.margin, labelWidth, baseline, size, this.pal.muted, 'left');
      this.placeLine(ln, this.margin + labelWidth, valueWidth, baseline, size, this.pal.ink, valueLines.length === 1 ? 'left' : 'start');
      this.y += box.height;
    });
    return this;
  }

  /** A bullet list item with a hanging indent; a small square marks it (on the right for RTL items). */
  bullet(content: string, options: { indent?: number; color?: RGB; size?: number; direction?: TextDirection } = {}): this {
    const size = options.size ?? TYPE.body;
    const indent = options.indent ?? 0;
    const marker = 12;
    const width = this.contentWidth - indent - marker;
    const lines = layoutText(content, { size, maxWidth: width, direction: options.direction });
    const rtl = lines[0]?.rtl ?? false;
    let last: [TextLine, number, number] | null = null;
    lines.forEach((ln, i) => {
      const box = lineBox(ln, size);
      this.ensure(box.height);
      const baseline = this.y + box.ascent;
      if (i === 0) {
        const sq = 2.6;
        const sx = rtl ? this.pageWidth - this.margin - indent - 1 - sq : this.margin + indent + 1;
        this.fillRect(sx, baseline - size * 0.28 - sq, sq, sq, options.color ?? this.pal.brand);
      }
      last = [ln, this.placeLine(ln, rtl ? this.margin : this.margin + indent + marker, width, baseline, size, this.pal.ink, 'start'), baseline];
      this.y += box.height;
    });
    if (last) this.noteLine(...(last as [TextLine, number, number]));
    return this;
  }

  /** A numbered list item with a hanging indent aligned past the number (mirrored for RTL items). */
  numbered(marker: string, content: string, options: { indent?: number; size?: number; direction?: TextDirection } = {}): this {
    const size = options.size ?? TYPE.body;
    const indent = options.indent ?? 0;
    const gutter = Math.max(16, measureText(marker, size, true) + size * 0.3 + 4);
    const width = this.contentWidth - indent - gutter;
    const lines = layoutText(content, { size, maxWidth: width, direction: options.direction });
    const rtl = lines[0]?.rtl ?? false;
    const markerLine = layoutText(marker, { size, bold: true, direction: rtl ? 'rtl' : 'ltr' })[0]!;
    let last: [TextLine, number, number] | null = null;
    lines.forEach((ln, i) => {
      const box = lineBox(ln, size);
      this.ensure(box.height);
      const baseline = this.y + box.ascent;
      if (i === 0) {
        const mx = rtl ? this.pageWidth - this.margin - indent - markerLine.width : this.margin + indent;
        drawTextLine(this.ink, markerLine, mx, baseline, size, toHex(this.pal.brand));
      }
      last = [ln, this.placeLine(ln, rtl ? this.margin : this.margin + indent + gutter, width, baseline, size, this.pal.ink, 'start'), baseline];
      this.y += box.height;
    });
    if (last) this.noteLine(...(last as [TextLine, number, number]));
    return this;
  }

  /**
   * Formatted text, block by block: paragraphs, a heading and (nested) bulleted or numbered lists,
   * in bold / italic faces, with underline, highlight and clickable links. `lead` puts a bullet or a
   * number before the first line and hangs everything after it (a note in a list of notes). Right-
   * to-left blocks are set from the right edge, their markers too.
   */
  richBlocks(blocks: PdfRichBlock[], options: { lead?: string; size?: number } = {}): this {
    const size = options.size ?? TYPE.body;
    const leadW = options.lead ? this.markerWidth(options.lead, size) : 0;
    let last: [TextLine, number, number] | null = null;
    blocks.forEach((b, bi) => {
      const heading = b.kind === 'heading';
      const s = heading ? size + 0.5 : size;
      const runs = heading ? b.runs.map((r) => ({ ...r, bold: true })) : b.runs;
      const itemIndent = b.kind === 'item' ? (b.level ?? 0) * 14 : 0;
      const markerW = b.kind === 'item' ? this.markerWidth(b.marker ?? BULLET, s) : 0;
      const textIndent = leadW + itemIndent + markerW;
      const width = this.contentWidth - textIndent;
      const lines = layoutStyledText(runs, { size: s, maxWidth: width });
      const rtl = lines[0]?.rtl ?? false;
      if (bi > 0) this.y += heading ? 4 : 2;
      lines.forEach((ln, i) => {
        const box = lineBox(ln, s);
        this.ensure(box.height);
        const baseline = this.y + box.ascent;
        if (i === 0 && bi === 0 && options.lead) this.drawMarker(options.lead, 0, baseline, s, rtl);
        if (i === 0 && b.kind === 'item') this.drawMarker(b.marker ?? BULLET, leadW + itemIndent, baseline, s, rtl);
        last = [ln, this.placeLine(ln, rtl ? this.margin : this.margin + textIndent, width, baseline, s, this.pal.ink, 'start'), baseline];
        this.y += box.height;
      });
    });
    if (last) this.noteLine(...(last as [TextLine, number, number]));
    return this;
  }

  /** Room a list marker takes before its text. */
  private markerWidth(marker: string, size: number): number {
    return marker === BULLET ? 12 : Math.max(16, measureText(marker, size, true) + size * 0.3 + 4);
  }

  /** A bullet (a small square) or a number, `offset` points in from the starting edge (the right one when right-to-left). */
  private drawMarker(marker: string, offset: number, baseline: number, size: number, rtl: boolean): void {
    if (marker === BULLET) {
      const sq = 2.6;
      const sx = rtl ? this.pageWidth - this.margin - offset - 1 - sq : this.margin + offset + 1;
      this.fillRect(sx, baseline - size * 0.28 - sq, sq, sq, this.pal.brand);
      return;
    }
    const line = layoutText(marker, { size, bold: true, direction: rtl ? 'rtl' : 'ltr' })[0]!;
    const mx = rtl ? this.pageWidth - this.margin - offset - line.width : this.margin + offset;
    drawTextLine(this.ink, line, mx, baseline, size, toHex(this.pal.brand));
  }

  /** The tones a summary cell is set in: its own colours, else its tone's in the site's colour scheme. */
  private toneColors(it: StatTile): { fill: RGB; text: RGB; soft: RGB } {
    const of = (t: Tone) => ({ fill: hexToRgb(t.fill), text: hexToRgb(t.text), soft: hexToRgb(t.soft) });
    if (it.colors) return of(it.colors);
    switch (it.tone) {
      case 'danger':
        return of(OVERDUE_TONES.light);
      case 'success':
        return of(STATUS_TONES.DONE.light);
      case 'warning':
        return of(DUE_SOON_TONES.light);
      case 'muted':
        return { ...of(STATUS_TONES.BACKLOG.light), text: this.pal.ink };
      default:
        return { fill: this.pal.brand, text: this.pal.ink, soft: mix(this.pal.brand, WHITE, 0.94) };
    }
  }

  /**
   * The summary strip: one slim row of cells, each its label (7.5 pt) over its value (10.5 pt) on
   * a soft tint with an edge in its colour, the value in its colour's text tone. A note sits beside
   * the value when it fits there, otherwise under it — never cut; a value too long for its cell
   * shrinks a little, then wraps. Every cell takes the tallest one's height.
   */
  statTiles(items: StatTile[]): this {
    if (items.length === 0) return this;
    const gap = 6;
    const w = (this.contentWidth - gap * (items.length - 1)) / items.length;
    const padX = 8;
    const padY = 4;
    const inner = w - padX * 2 - 2;
    const label = TYPE.label;
    const box = (size: number) => ({ height: size * 1.22, ascent: size * 0.96 });
    const laid = items.map((it) => {
      let size: number = TYPE.value;
      while (size > TYPE.body && measureText(it.value, size, true) > inner) size -= 0.5;
      const values = layoutText(it.value, { size, bold: true, maxWidth: inner });
      const labels = layoutText(it.label, { size: label, maxWidth: inner });
      const noteW = it.note ? measureText(it.note, TYPE.small, true) : 0;
      const beside = !it.note || (values.length === 1 && values[0]!.width + 6 + noteW <= inner);
      const note = it.note && !beside ? layoutText(it.note, { size: TYPE.small, bold: true, maxWidth: inner }) : [];
      const height = padY * 2 + labels.length * box(label).height + 1 + values.length * box(size).height + note.length * box(TYPE.small).height;
      return { it, size, values, labels, beside, note, height, colors: this.toneColors(it) };
    });
    const h = Math.max(...laid.map((l) => l.height));
    this.ensure(h + 6);
    const top = this.y;
    laid.forEach(({ it, size, values, labels, beside, note, colors }, i) => {
      const x = this.margin + i * (w + gap);
      this.ink.roundedRect(x, top, w, h, 3).fill(toHex(colors.soft));
      this.ink.save();
      this.ink.roundedRect(x, top, w, h, 3).clip();
      this.fillRect(x, top, 2, h, colors.fill);
      this.ink.restore();
      const tx = x + padX + 2;
      let y = top + padY;
      for (const ln of labels) {
        drawTextLine(this.ink, ln, tx, y + box(label).ascent, label, toHex(this.pal.muted));
        y += box(label).height;
      }
      y += 1;
      values.forEach((ln, li) => {
        drawTextLine(this.ink, ln, tx, y + box(size).ascent, size, toHex(colors.text));
        if (li === 0 && it.note && beside) {
          const n = layoutText(it.note, { size: TYPE.small, bold: true })[0]!;
          drawTextLine(this.ink, n, tx + ln.width + 6, y + box(size).ascent, TYPE.small, toHex(colors.text));
        }
        y += box(size).height;
      });
      for (const ln of note) {
        drawTextLine(this.ink, ln, tx, y + box(TYPE.small).ascent, TYPE.small, toHex(colors.text));
        y += box(TYPE.small).height;
      }
    });
    this.y = top + h + 6;
    return this;
  }

  /** Horizontal bars, one per item, scaled to the largest value; each row is kept whole. */
  barList(items: BarItem[], options: { size?: number } = {}): this {
    const size = Math.max(TYPE.min, options.size ?? TYPE.data);
    const rowH = 14;
    const labelW = Math.min(170, Math.max(...items.map((it) => measureText(it.label, size)), 40) + 10);
    const valueW = Math.max(...items.map((it) => measureText(String(it.value), size, true)), 14) + 8;
    const barMax = this.contentWidth - labelW - valueW - 6;
    const max = Math.max(...items.map((it) => it.value), 1);
    for (const it of items) {
      this.ensure(rowH);
      const box = lineBox(null, size, true);
      const baseline = this.y + (rowH - box.height) / 2 + box.ascent;
      const label = layoutText(it.label, { size, maxWidth: labelW - 10 })[0];
      if (label) this.placeLine(label, this.margin, labelW - 10, baseline, size, this.pal.ink, 'left');
      const bx = this.margin + labelW;
      this.fillRect(bx, this.y + 4, barMax, rowH - 8, mix(this.pal.line, WHITE, 0.6));
      const bw = (barMax * Math.max(0, it.value)) / max;
      if (bw > 0) this.fillRect(bx, this.y + 4, Math.max(bw, 1.5), rowH - 8, it.color ? hexToRgb(it.color, this.pal.brand) : this.pal.brand);
      const v = layoutText(String(it.value), { size, bold: true })[0]!;
      drawTextLine(this.ink, v, this.margin + this.contentWidth - v.width, baseline, size, toHex(this.pal.ink));
      this.y += rowH;
    }
    this.y += 4;
    return this;
  }

  /** A line chart with a legend, a value axis with gridlines and first/middle/last day labels. Kept whole on one page. */
  lineChart(opts: { labels: string[]; series: ChartSeries[]; height?: number }): this {
    const height = opts.height ?? 120;
    const legendH = 18;
    const small = TYPE.label;
    this.ensure(height + legendH + 6);
    const defaults: RGB[] = [this.pal.ink, this.pal.brand, WARNING, SUCCESS];
    const colors = opts.series.map((s, i) => (s.color ? hexToRgb(s.color, defaults[i % defaults.length]!) : defaults[i % defaults.length]!));
    // Legend.
    let lx = this.margin;
    opts.series.forEach((s, i) => {
      this.fillRect(lx, this.y + 3, 8, 8, colors[i]!);
      const name = layoutText(s.name, { size: TYPE.small })[0]!;
      drawTextLine(this.ink, name, lx + 12, this.y + 10, TYPE.small, toHex(this.pal.ink));
      lx += 12 + name.width + 14;
    });
    this.y += legendH;
    const top = this.y;
    const max = Math.max(1, ...opts.series.flatMap((s) => s.values));
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((st) => st * 4 >= max) ?? Math.ceil(max / 4);
    const yMax = step * 4;
    const axisW = Math.max(measureText(String(yMax), small), 10) + 8;
    const left = this.margin + axisW;
    const plotW = this.contentWidth - axisW;
    const plotH = height - 14;
    const yOf = (v: number) => top + plotH - (plotH * v) / yMax;
    for (let g = 0; g <= 4; g++) {
      const gy = yOf(g * step);
      this.fillRect(left, snap(gy, this.pageHeight), plotW, 0.5, g === 0 ? this.pal.muted : mix(this.pal.line, WHITE, 0.3));
      const t = layoutText(String(g * step), { size: small })[0]!;
      drawTextLine(this.ink, t, left - 6 - t.width, gy + 3, small, toHex(this.pal.muted));
    }
    const n = opts.labels.length;
    const xOf = (i: number) => (n <= 1 ? left + plotW / 2 : left + (plotW * i) / (n - 1));
    opts.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [xOf(i), yOf(Math.max(0, v))] as const);
      if (pts.length === 0) return;
      this.ink.save().lineWidth(1.5).lineJoin('round').lineCap('round');
      this.ink.moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts.slice(1)) this.ink.lineTo(x, y);
      if (pts.length === 1) this.ink.lineTo(pts[0]![0] + 0.1, pts[0]![1]);
      this.ink.stroke(toHex(colors[si]!)).restore();
      if (pts.length <= 31) for (const [x, y] of pts) this.ink.circle(x, y, 1.5).fill(toHex(colors[si]!));
    });
    const marks = n <= 1 ? [0] : [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
    for (const i of marks) {
      const t = layoutText(opts.labels[i] ?? '', { size: small })[0];
      if (!t) continue;
      const x = Math.min(Math.max(xOf(i) - t.width / 2, left), this.margin + this.contentWidth - t.width);
      drawTextLine(this.ink, t, x, top + plotH + 11, small, toHex(this.pal.muted));
    }
    this.y = top + height + 6;
    return this;
  }

  /** A full-width hairline rule. */
  rule(color?: RGB): this {
    this.spacer(4);
    this.ensure(4);
    this.hairline(this.y, color ?? this.pal.line);
    this.y += 4;
    return this;
  }

  /**
   * A data table spanning the content width. Columns are sized from their content (see
   * fitColumns: every column at least its longest word, the room left to the columns with the
   * most to say; a table too wide sets its type smaller, never under 7.5 pt), cells wrap within
   * their column, rows never split across pages (unless one is taller than a page on its own: then
   * its lines continue on the next page under "(continued)", so nothing is cut), and the header row
   * repeats at the top of every page. Numbers align right and dates centre, the header with its
   * column; text cells align to their own direction (Arabic right, English left). Light zebra rows.
   */
  table(
    columns: TableColumn[],
    rows: ReadonlyArray<ReadonlyArray<string>>,
    options: {
      size?: number;
      cellColor?: (row: number, col: number) => RGB | null;
      /** Body cells set in bold (e.g. a failed result, so it stands out by more than its colour). */
      cellBold?: (row: number, col: number) => boolean;
      /** The column that takes the width left over when every cell fits on one line. */
      wide?: number;
      /** How small the type may go to fit (never under 7.5 pt). */
      fit?: { minSize?: number };
    } = {},
  ): this {
    const n = columns.length;
    if (n === 0) return this;
    const layout = this.tableLayout(columns, rows, options.size ?? TYPE.table, options.wide, options.fit, options.cellBold);
    const { size, padX, padY, total, widths, align, header, body } = layout;
    const continuedSize = TYPE.label;

    // Lines [from, to) of a row: all of it, or the part of a too-tall row that goes on this page.
    const drawRow = (row: TableRowLayout, fill: RGB | null, ri: number | null, from = 0, to = row.lines) => {
      const box = row.box;
      const continued = from > 0;
      const height = (to - from + (continued ? 1 : 0)) * box.height + padY * 2;
      if (fill) this.fillRect(this.margin, this.y, total, height, fill);
      if (continued) {
        const note = layoutText('(continued)', { size: continuedSize })[0]!;
        drawTextLine(this.ink, note, this.margin + padX, this.y + padY + box.ascent, continuedSize, toHex(this.pal.muted));
      }
      const top = this.y + padY + (continued ? box.height : 0);
      let x = this.margin;
      row.laid.forEach((lines, ci) => {
        const color = (ri !== null && options.cellColor?.(ri, ci)) || this.pal.ink;
        for (let li = from; li < Math.min(to, lines.length); li++) {
          const baseline = top + (li - from) * box.height + box.ascent;
          this.placeLine(lines[li]!, x + padX, widths[ci]! - padX * 2, baseline, size, color, align[ci]!);
        }
        x += widths[ci]!;
      });
      this.hairline(this.y + height - 0.5, this.pal.line, this.ink, total);
      this.y += height;
    };

    const headerFill = mix(this.pal.brand, WHITE, 0.91);
    const stripe = mix(this.pal.line, WHITE, 0.75);
    const plan = paginateRows(
      body.map((r) => r.lines),
      {
        lineHeight: header.box.height,
        lineHeights: body.map((r) => r.box.height),
        padY,
        header: header.height,
        room: this.remaining,
        pageRoom: this.contentBottom - CONTINUATION_TOP,
        atTop: this.atTop,
        continuedLines: 1,
      },
    );
    if (plan.newPage) this.newPage();
    plan.pages.forEach((pieces, pi) => {
      if (pi > 0) this.newPage();
      drawRow(header, headerFill, null); // the header on every page the table is on
      for (const p of pieces) drawRow(body[p.row]!, p.row % 2 === 1 ? stripe : null, p.row, p.from, p.to);
    });
    return this;
  }

  /**
   * The height a table would take if drawn now on one page (header + every row, or just its first
   * `firstRows` rows — columns sized from all of them, as table() sizes them), in points.
   */
  tableHeight(
    columns: TableColumn[],
    rows: ReadonlyArray<ReadonlyArray<string>>,
    options: { size?: number; wide?: number; firstRows?: number; fit?: { minSize?: number }; cellBold?: (row: number, col: number) => boolean } = {},
  ): number {
    if (columns.length === 0) return 0;
    const { header, body } = this.tableLayout(columns, rows, options.size ?? TYPE.table, options.wide, options.fit, options.cellBold);
    return header.height + body.slice(0, options.firstRows ?? body.length).reduce((s, r) => s + r.height, 0);
  }

  private tableLayout(
    columns: TableColumn[],
    rows: ReadonlyArray<ReadonlyArray<string>>,
    baseSize: number,
    wide?: number,
    fit?: { minSize?: number },
    cellBold?: (row: number, col: number) => boolean,
  ) {
    const padX = TABLE_PAD_X;
    const padY = TABLE_PAD_Y;
    const total = this.contentWidth;
    const start = Math.max(TYPE.tableMin, baseSize);
    const { kinds, measured } = measureTable(columns, rows);
    const plan = fitColumns(measured, total, { size: start, minSize: Math.max(TYPE.tableMin, fit?.minSize ?? TYPE.tableMin), padX, wide });
    const size = plan.size;
    const widths = plan.widths;

    const align = columns.map((c, ci): TextAlign => {
      if (c.align === 'right') return 'right';
      if (c.align === 'left') return 'start';
      if (c.align === 'center') return 'center';
      return kinds[ci] === 'number' ? 'right' : kinds[ci] === 'date' ? 'center' : 'start';
    });

    // Every line of every cell is kept: a row taller than a page continues on the next (see table()).
    // Each row has its own line height: the normal one, or the taller Arabic one when the row has
    // Arabic (its cells still share one baseline).
    const layoutRow = (cells: ReadonlyArray<string>, bold: boolean, ri?: number): TableRowLayout => {
      const laid = columns.map((_, ci) => {
        const text = cells[ci] ?? '';
        const opts = { size, bold: bold || (ri !== undefined && cellBold?.(ri, ci) === true), maxWidth: widths[ci]! - padX * 2 };
        const lines = layoutText(text, opts);
        // A date whose note doesn't fit beside it: the date on its line, the note (its dot too) under it.
        const date = ri !== undefined && kinds[ci] === 'date' && lines.length > 1 ? DATE_PART.exec(text.trim())?.[0] : undefined;
        return date ? [...layoutText(date, opts), ...layoutText(text.trim().slice(date.length).trim(), opts)] : lines;
      });
      const lines = Math.max(1, ...laid.map((l) => l.length));
      const rowBox = lineBox(null, size, laid.some((cell) => cell.some((ln) => ln.arabic)));
      return { laid, lines, box: rowBox, height: lines * rowBox.height + padY * 2 };
    };

    const header = layoutRow(
      columns.map((c) => c.header),
      true,
    );
    const body = rows.map((r, ri) => layoutRow(r, false, ri));
    return { size, padX, padY, total, widths, align, header, body };
  }

  // ── Running header and footer ────────────────────────────────────────────────────────────────

  /** The footer laid out for a page in this orientation (cached). */
  private footerLayout(orientation: PageOrientation): FooterLayout {
    const cached = this.footers.get(orientation);
    if (cached) return cached;
    const f = this.opts.footer ?? {};
    const size = TYPE.label;
    const width = contentWidthOf(orientation);
    const pageW = measureText('Page 99 of 99', size);
    const company = f.company?.trim() ? layoutText(f.company.trim(), { size, bold: true, direction: 'ltr' })[0] ?? null : null;
    const printed = f.printed?.trim() ? layoutText(f.printed.trim(), { size, direction: 'ltr' })[0] ?? null : null;
    const cw = company?.width ?? 0;
    const pw = printed?.width ?? 0;
    let printedAt: FooterLayout['printedAt'] = 'centre';
    if (printed) {
      const centreX = (width - pw) / 2;
      if (cw + 16 > centreX || centreX + pw + 16 > width - pageW) printedAt = cw + (cw ? 12 : 0) + pw + 16 + pageW <= width ? 'after' : 'own';
    }
    const rows: FooterLayout['rows'] = [];
    if (printed && printedAt === 'own') for (const line of layoutText(f.printed!.trim(), { size, maxWidth: width, direction: 'ltr' })) rows.push({ line });
    for (const extra of f.extra ?? []) {
      if (!extra.trim()) continue;
      // A left-aligned block: each line laid out left-to-right (Arabic runs still read right-to-left), wrapped, never cut.
      for (const line of layoutText(extra.trim(), { size, maxWidth: width, direction: 'ltr' })) rows.push({ line });
    }
    const layout: FooterLayout = { company, printed, printedAt, rows, band: BOTTOM + (1 + rows.length) * FOOTER_ROW + 4.5 };
    this.footers.set(orientation, layout);
    return layout;
  }

  /** The running header of a later page (as a page artifact): the project's mark, the title, the company logo, a hairline. */
  private drawRunningHeader(doc: PDFKit.PDFDocument): void {
    const top = TOP;
    let x = this.margin;
    if (this.projectMark) {
      this.drawMark(this.projectMark, x, top, RUN_MARK, doc);
      x += RUN_MARK + 6;
    } else if (this.brandMark) {
      this.logoMark(x, this.pageHeight - top - RUN_MARK, RUN_MARK, this.brandMark.from, this.brandMark.to, doc);
      x += RUN_MARK + 6;
    }
    const logoW = this.drawLogo(top, RUN_MARK, 70, doc);
    const title = (this.opts.runningTitle ?? this.opts.title ?? '').replace(/\s+/g, ' ').trim();
    if (title) {
      // A title too long for the header ends with "…" (the first page's own header shows it in full).
      const size = TYPE.small;
      const t = fitLine(title, { size, minSize: TYPE.min, maxWidth: this.margin + this.contentWidth - logoW - 12 - x });
      drawTextLine(doc, t.line, x, top + RUN_MARK / 2 + t.size * 0.36, t.size, toHex(this.pal.muted));
    }
    this.hairline(RUN_RULE, this.pal.line, doc);
  }

  /** The footer of a page (as a page artifact): a hairline; the company, when printed and by whom, the page number; the extra lines. */
  private drawFooter(doc: PDFKit.PDFDocument, page: number, pages: number): void {
    const f = this.footerLayout(this.orientation);
    const size = TYPE.label;
    const muted = toHex(this.pal.muted);
    const width = this.contentWidth;
    const ruleTop = this.pageHeight - f.band;
    this.hairline(ruleTop, this.pal.line, doc);
    const baseline = (row: number) => ruleTop + 0.5 + 4 + size * 0.96 + row * FOOTER_ROW;
    const pageLine = layoutText(`Page ${page} of ${pages}`, { size, direction: 'ltr' })[0]!;
    drawTextLine(doc, pageLine, this.margin + width - pageLine.width, baseline(0), size, muted);
    let x = this.margin;
    if (f.company) {
      drawTextLine(doc, f.company, x, baseline(0), size, toHex(mix(this.pal.ink, this.pal.muted, 0.35)));
      x += f.company.width + 12;
    }
    if (f.printed && f.printedAt !== 'own') {
      const px = f.printedAt === 'centre' ? this.margin + (width - f.printed.width) / 2 : x;
      drawTextLine(doc, f.printed, px, baseline(0), size, muted);
    }
    f.rows.forEach((r, i) => drawTextLine(doc, r.line, this.margin, baseline(i + 1), size, muted));
  }

  /** Serialize to a PDF byte buffer (idempotent). */
  build(): Buffer {
    if (this.built) return this.built;
    if (this.orients.length === 0) void this.ink; // an empty document still has its one page
    this.pending = false; // a page waiting for content is never added: no blank last page
    const range = this.pdfkit.bufferedPageRange();
    const total = range.count;
    const current = this.orientation;
    const doc = this.pdfkit;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(range.start + i);
      this.orientation = this.orients[i] ?? 'portrait';
      // Page furniture is marked as such (an artifact), so readers and copy/paste skip it.
      doc.markContent('Artifact', { type: 'Pagination' });
      if (i > 0) this.drawRunningHeader(doc);
      this.drawFooter(doc, i + 1, total);
      doc.endMarkedContent();
    }
    this.orientation = current;
    this.builtPages = total;
    this.pdfkit.end();
    // pdfkit writes the whole file synchronously during end(); drain the stream buffer.
    const chunks: Buffer[] = [];
    for (let c = this.pdfkit.read() as Buffer | null; c !== null; c = this.pdfkit.read() as Buffer | null) chunks.push(c);
    this.built = Buffer.concat(chunks);
    return this.built;
  }
}

/**
 * What each column of a table holds — numbers (right-aligned), dates (centred) or text — and its
 * content measured for fitColumns. A date column is at least as wide as its widest date, so a date
 * never breaks inside itself (lines break only at spaces, and a cell's date comes first); a note
 * after it ("· Overdue") may go under it.
 */
function measureTable(columns: TableColumn[], rows: ReadonlyArray<ReadonlyArray<string>>) {
  const kinds = columns.map((_, ci) => {
    const vals = rows.map((r) => (r[ci] ?? '').trim()).filter((v) => v.length > 0 && v !== '—');
    if (vals.length === 0) return 'text' as const;
    return vals.every((v) => NUMERIC.test(v)) ? ('number' as const) : vals.every((v) => DATE.test(v)) ? ('date' as const) : ('text' as const);
  });
  const measured = measureColumns(columns, rows).map((m, ci) => {
    if (kinds[ci] !== 'date') return m;
    const widest = Math.max(0, ...rows.map((r) => DATE_PART.exec((r[ci] ?? '').trim())?.[0]).map((d) => (d ? measureText(d, 1) : 0)));
    return { ...m, longestWord: Math.min(m.natural, Math.max(m.longestWord, widest)) };
  });
  return { kinds, measured };
}

/** A table row laid out: each cell's lines, the most lines any cell has, its line box and its height. */
interface TableRowLayout {
  laid: TextLine[][];
  lines: number;
  box: { height: number; ascent: number };
  height: number;
}

/**
 * One line of text that must fit `maxWidth`: set at `size`, or smaller (in half points, down to
 * `minSize`) when it doesn't fit; if it still doesn't, it is cut at the last character that fits
 * and ends with "…", so a shortened line always says so.
 */
function fitLine(text: string, opts: { size: number; minSize?: number; maxWidth: number; direction?: TextDirection }): { line: TextLine; size: number } {
  const one = (t: string, size: number) => layoutText(t, { size, direction: opts.direction })[0]!;
  let size = opts.size;
  let line = one(text, size);
  while (line.width > opts.maxWidth && size - 0.5 >= (opts.minSize ?? opts.size) - 1e-9) {
    size -= 0.5;
    line = one(text, size);
  }
  if (line.width <= opts.maxWidth) return { line, size };
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureText(`${text.slice(0, mid).trimEnd()}…`, size) <= opts.maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return { line: one(`${text.slice(0, lo).trimEnd()}…`, size), size };
}
