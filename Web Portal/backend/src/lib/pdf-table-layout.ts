/**
 * Table layout for the PDF documents: how wide each column is and at what type size, and which
 * rows (or, for a row taller than a page, which of its lines) go on which page. Sizes in, sizes
 * out — PdfDocument.table draws what these decide, and the tests check them without a PDF.
 */
import { measureText } from './pdf-text';

/** What one column holds, measured for a 1 pt font (text widths grow in step with the type size). */
export interface ColumnMeasure {
  /** Its widest single line: the header (bold) or a cell, unwrapped. */
  natural: number;
  /** Its longest piece that shouldn't break: a word (a very long one is capped: it may break), or a whole cell when the column is kept on one line. */
  longestWord: number;
  /**
   * The words of each of its cells, header first (a column that wraps): how many lines a cell takes
   * at a width can be told without laying it out, so fitColumns can trade width between columns.
   */
  cells?: CellWords[];
}

/** One cell's words and the space between them, measured for a 1 pt font. */
export interface CellWords {
  words: number[];
  space: number;
}

/** A column to measure: its header, and whether its cells stay on one line (dates, numbers, keys). */
export interface MeasuredColumn {
  header: string;
  nowrap?: boolean;
}

/**
 * A word longer than this (in ems) counts as this long when columns are sized: a link or a long
 * code doesn't claim a column of its own width; it breaks inside its cell instead (after a slash
 * or other punctuation where it can, see pdf-text).
 */
const WORD_CAP_EM = 12;

/** Measure columns' content (header in bold, every cell) for fitColumns. */
export function measureColumns(columns: ReadonlyArray<MeasuredColumn>, rows: ReadonlyArray<ReadonlyArray<string>>): ColumnMeasure[] {
  const words = new Map<string, number>();
  const word = (w: string, bold: boolean) => {
    const key = `${bold ? 'b' : 'r'}${w}`;
    let width = words.get(key);
    if (width === undefined) {
      width = Math.min(WORD_CAP_EM, measureText(w, 1, bold));
      words.set(key, width);
    }
    return width;
  };
  const full = new Map<string, number>();
  /** A word's whole width (uncapped: for counting lines). */
  const wordWidth = (w: string, bold: boolean) => {
    const key = `${bold ? 'b' : 'r'}${w}`;
    let width = full.get(key);
    if (width === undefined) {
      width = measureText(w, 1, bold);
      full.set(key, width);
    }
    return width;
  };
  const longest = (text: string, bold: boolean) => text.split(/\s+/).reduce((m, w) => (w ? Math.max(m, word(w, bold)) : m), 0);
  const space = measureText('a a', 1) - measureText('aa', 1);
  const cellWords = (text: string, bold: boolean): CellWords => ({ words: text.split(/\s+/).filter(Boolean).map((w) => wordWidth(w, bold)), space });
  return columns.map((c, ci) => {
    let natural = measureText(c.header, 1, true);
    let longestWord = longest(c.header, true);
    const cells: CellWords[] | undefined = c.nowrap ? undefined : [cellWords(c.header, true)];
    for (const r of rows) {
      const cell = r[ci] ?? '';
      if (cells) cells.push(cellWords(cell, false));
      if (!cell.trim()) continue;
      const w = measureText(cell, 1);
      natural = Math.max(natural, w);
      longestWord = Math.max(longestWord, c.nowrap ? w : longest(cell, false));
    }
    return { natural, longestWord: Math.min(longestWord, natural), ...(cells ? { cells } : {}) };
  });
}

/** How many lines a cell takes at a width (in ems), wrapping as the text engine does: by words, a word too long broken. */
export function cellLines(cell: CellWords, width: number): number {
  if (width <= 0) return Math.max(1, cell.words.length);
  let lines = 1;
  let used = 0;
  for (const w of cell.words) {
    if (used > 0 && used + cell.space + w <= width + 1e-9) {
      used += cell.space + w;
      continue;
    }
    if (used > 0) lines++;
    // A word wider than the line takes as many lines as it needs; the next word starts after its last piece.
    const pieces = Math.max(1, Math.ceil(w / width - 1e-9));
    lines += pieces - 1;
    used = w - (pieces - 1) * width;
  }
  return lines;
}

export interface ColumnPlan {
  /** The type size the table is set in. */
  size: number;
  /** Each column's width in points (padding included); they add up to the table's width. */
  widths: number[];
  /** Every column is at least as wide as its longest word (false: some words break inside their cells). */
  fits: boolean;
}

/** A column whose longest line is no wider than this (in ems) is a short phrase: once on one line, it stays there. */
const SHORT_PHRASE_EM = 14;

/** No column is narrower than this (points). */
export const MIN_COLUMN = 30;

/**
 * Column widths, the way a browser lays out an automatic table:
 * - everything fits on one line: each column gets its line, and the spare width is shared out in
 *   proportion (or, with `wide`, goes to that one column while the others get a little air);
 * - otherwise each column gets at least its longest word, and the room left is shared by how much
 *   more each would like (its line less its longest word): a long title gets more than a name;
 * - when even the longest words don't fit, the type shrinks in half points down to `minSize` (by
 *   default it doesn't shrink); past that, the columns share the width in proportion to their
 *   longest words, and long words break inside their cells. The table is never wider than `total`.
 */
export function fitColumns(measures: ReadonlyArray<ColumnMeasure>, total: number, opts: { size: number; minSize?: number; padX: number; wide?: number }): ColumnPlan {
  const n = measures.length;
  if (n === 0) return { size: opts.size, widths: [], fits: true };
  const minSize = Math.min(opts.size, opts.minSize ?? opts.size);
  const bounds = (size: number) => {
    const min = measures.map((m) => Math.max(MIN_COLUMN, m.longestWord * size + opts.padX * 2));
    const max = measures.map((m, i) => Math.max(min[i]!, m.natural * size + opts.padX * 2));
    return { min, max, sumMin: sum(min), sumMax: sum(max) };
  };
  let size = opts.size;
  let b = bounds(size);
  while (b.sumMin > total + 1e-6 && size - 0.5 >= minSize - 1e-9) {
    size = Math.round((size - 0.5) * 2) / 2;
    b = bounds(size);
  }
  const { min, max, sumMin, sumMax } = b;
  const wide = opts.wide !== undefined && opts.wide >= 0 && opts.wide < n ? opts.wide : undefined;
  if (sumMax <= total) {
    const spare = total - sumMax;
    if (wide !== undefined) {
      const air = n > 1 ? Math.min(14, spare / n) : 0;
      const widths = max.map((w) => w + air);
      widths[wide] = max[wide]! + spare - air * (n - 1);
      return { size, widths, fits: true };
    }
    return { size, widths: max.map((w) => w + spare * (w / sumMax)), fits: true };
  }
  if (sumMin <= total + 1e-6) {
    // Short phrases first: a column whose whole line costs no more than an equal share of the room
    // left gets it (cheapest first), so "In progress" or a project's name doesn't wrap while a long
    // title takes everything. The rest is shared by how much more each of the others would like.
    const widths = [...min];
    let spare = Math.max(0, total - sumMin);
    const want = max.map((w, i) => w - min[i]!);
    const open = want.map((w, i) => i).filter((i) => want[i]! > 0).sort((a, b) => want[a]! - want[b]!);
    while (open.length > 0 && want[open[0]!]! <= spare / open.length) {
      const i = open.shift()!;
      widths[i] = max[i]!;
      spare -= want[i]!;
    }
    const sumWant = sum(open.map((i) => want[i]!));
    if (open.length > 0) for (const i of open) widths[i] = min[i]! + (spare * want[i]!) / sumWant;
    else widths.forEach((_, i) => (widths[i] = widths[i]! + spare / n));
    // Then the columns trade width while that saves lines: a list of names doesn't take three lines
    // while a long title has width to spare. A short phrase already on its one line keeps it.
    return { size, widths: rebalance(widths, min, max, measures, size, opts.padX, open), fits: true };
  }
  return { size, widths: min.map((w) => (w * total) / sumMin), fits: false };
}

/** Lines [from, to) of table row `row`: a whole row, or the part of a row taller than a page that goes on one page. */
export interface RowPiece {
  row: number;
  from: number;
  to: number;
}

export interface TablePages {
  /** The table starts on a new page (the header and its first row don't fit in what is left). */
  newPage: boolean;
  /** The pieces on each page, in order; each page has the header row above them. */
  pages: RowPiece[][];
}

/**
 * Which rows go on which page. A row is never split across pages unless it is taller than a page
 * on its own; then its lines continue on the next page(s), each part under the repeated header,
 * and every line is placed once. Heights are in points; a row of n lines is n × lineHeight + 2 × padY.
 */
export function paginateRows(
  lines: ReadonlyArray<number>,
  opts: {
    lineHeight: number;
    /** Each row's own line height, when rows differ (a row with Arabic is taller); else lineHeight for all. */
    lineHeights?: ReadonlyArray<number>;
    padY: number;
    /** The header row's height. */
    header: number;
    /** Room left on the current page, from the cursor down to the bottom margin. */
    room: number;
    /** Room on a fresh page. */
    pageRoom: number;
    /** The cursor is at the top of a page already (never start another one). */
    atTop: boolean;
    /** A row split across pages starts on the current page only if this many of its lines fit there (default 2). */
    minLines?: number;
  },
): TablePages {
  const { padY, header } = opts;
  const minLines = opts.minLines ?? 2;
  const lineHeightOf = (row: number) => opts.lineHeights?.[row] ?? opts.lineHeight;
  const fresh = opts.pageRoom - header;
  const first = lines[0];
  const firstHeight = (n: number) => n * lineHeightOf(0) + padY * 2;
  const need = header + (first === undefined ? 0 : firstHeight(firstHeight(first) <= fresh ? first : Math.min(first, minLines)));
  const newPage = opts.room < need && !opts.atTop;

  const pages: RowPiece[][] = [[]];
  let left = (newPage ? opts.pageRoom : opts.room) - header;
  const turn = () => {
    pages.push([]);
    left = fresh;
  };
  lines.forEach((n, row) => {
    const lh = lineHeightOf(row);
    const height = (k: number) => k * lh + padY * 2;
    const h = height(n);
    if (h <= left) {
      pages[pages.length - 1]!.push({ row, from: 0, to: n });
      left -= h;
      return;
    }
    if (h <= fresh) {
      turn();
      pages[pages.length - 1]!.push({ row, from: 0, to: n });
      left -= h;
      return;
    }
    // Taller than a page: fill what is left (if enough of it fits), then page after page.
    let from = 0;
    while (from < n) {
      const page = pages[pages.length - 1]!;
      let fit = Math.floor((left - padY * 2) / lh + 1e-9);
      if (fit < Math.min(minLines, n - from) && page.length > 0) {
        turn();
        continue;
      }
      fit = Math.max(1, fit);
      const to = Math.min(n, from + fit);
      page.push({ row, from, to });
      left -= height(to - from);
      from = to;
      if (from < n) turn();
    }
  });
  return { newPage, pages };
}

/**
 * Move width between the columns that wrap (`open`), a step at a time (large steps first), while the
 * table gets shorter: the sum over its rows (header included) of the most lines any cell of the row
 * takes, and on a tie the lines of all its cells.
 */
function rebalance(start: number[], min: number[], max: number[], measures: ReadonlyArray<ColumnMeasure>, size: number, padX: number, open: number[]): number[] {
  // A short phrase on its one line (a status, a project's name) keeps it; longer columns may trade.
  const cols = measures.map((_, i) => i).filter((i) => measures[i]!.cells?.length && (open.includes(i) || measures[i]!.natural > SHORT_PHRASE_EM));
  if (cols.length < 2) return start;
  const rows = Math.min(...cols.map((i) => measures[i]!.cells!.length));
  const widths = [...start];
  const linesAt = (col: number, w: number) => measures[col]!.cells!.slice(0, rows).map((c) => cellLines(c, (w - padX * 2) / size));
  const lines = new Map(cols.map((c) => [c, linesAt(c, widths[c]!)]));
  // The table's height in lines; on a tie, fewer lines in all its cells (fewer cells wrapped further than they need).
  const height = (override: Map<number, number[]>) => {
    let h = 0;
    let all = 0;
    for (let r = 0; r < rows; r++) {
      let most = 1;
      for (const c of cols) {
        const k = (override.get(c) ?? lines.get(c)!)[r]!;
        most = Math.max(most, k);
        all += k;
      }
      h += most;
    }
    return h * 1e6 + all;
  };
  let current = height(new Map());
  for (const step of [48, 24, 12, 6, 3]) {
    for (let guard = 0; guard < 200; guard++) {
      let best: { from: number; to: number; h: number; lf: number[]; lt: number[] } | null = null;
      for (const from of cols) {
        if (widths[from]! - step < min[from]! - 1e-9) continue;
        const lf = linesAt(from, widths[from]! - step);
        for (const to of cols) {
          if (to === from || widths[to]! + step > max[to]! + 1e-9) continue;
          const lt = linesAt(to, widths[to]! + step);
          const h = height(new Map([[from, lf], [to, lt]]));
          if (h < (best?.h ?? current)) best = { from, to, h, lf, lt };
        }
      }
      if (!best) break;
      widths[best.from] = widths[best.from]! - step;
      widths[best.to] = widths[best.to]! + step;
      lines.set(best.from, best.lf);
      lines.set(best.to, best.lt);
      current = best.h;
    }
  }
  return widths;
}

function sum(xs: ReadonlyArray<number>): number {
  return xs.reduce((a, b) => a + b, 0);
}
