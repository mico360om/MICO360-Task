import { describe, it, expect } from 'vitest';
import { fitColumns, measureColumns, paginateRows, type ColumnMeasure } from './pdf-table-layout';
import { measureText } from './pdf-text';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const PAD = 5;

describe('table columns: widths and type size', () => {
  it('a table that fits on one line keeps every column at least its natural width and fills the width exactly', () => {
    const cols: ColumnMeasure[] = [
      { natural: 4, longestWord: 4 },
      { natural: 10, longestWord: 5 },
      { natural: 6, longestWord: 6 },
    ];
    const plan = fitColumns(cols, 400, { size: 10, padX: PAD });
    expect(plan.size).toBe(10);
    expect(plan.fits).toBe(true);
    expect(sum(plan.widths)).toBeCloseTo(400, 6);
    plan.widths.forEach((w, i) => expect(w).toBeGreaterThanOrEqual(cols[i]!.natural * 10 + PAD * 2));
  });

  it('can still give the spare width to one column (the others hug their content)', () => {
    const cols: ColumnMeasure[] = [
      { natural: 4, longestWord: 4 },
      { natural: 10, longestWord: 5 },
      { natural: 6, longestWord: 6 },
    ];
    const plan = fitColumns(cols, 400, { size: 10, padX: PAD, wide: 1 });
    expect(plan.widths[0]).toBeLessThanOrEqual(4 * 10 + PAD * 2 + 14);
    expect(plan.widths[2]).toBeLessThanOrEqual(6 * 10 + PAD * 2 + 14);
    expect(sum(plan.widths)).toBeCloseTo(400, 6);
  });

  it('when text must wrap, no column is narrower than its longest word, and the spare room goes to the columns with the most to say', () => {
    // A long title column, a moderate names column and a date kept on one line.
    const cols: ColumnMeasure[] = [
      { natural: 60, longestWord: 6 }, // title
      { natural: 20, longestWord: 7 }, // names
      { natural: 6, longestWord: 6 }, // date (nowrap: longest piece = whole cell)
    ];
    const plan = fitColumns(cols, 400, { size: 9, padX: PAD });
    expect(plan.fits).toBe(true);
    expect(sum(plan.widths)).toBeCloseTo(400, 6);
    plan.widths.forEach((w, i) => expect(w + 1e-9).toBeGreaterThanOrEqual(cols[i]!.longestWord * 9 + PAD * 2));
    // The title (54 units more than its longest word) gets far more than the names column (13 more).
    expect(plan.widths[0]! - (6 * 9 + PAD * 2)).toBeGreaterThan(3 * (plan.widths[1]! - (7 * 9 + PAD * 2)));
    // The date column is exactly its one line.
    expect(plan.widths[2]).toBeCloseTo(6 * 9 + PAD * 2, 6);
  });

  it('short phrases (a status, a project’s name) stay on one line when there is room: the cheapest columns are satisfied first', () => {
    const cols: ColumnMeasure[] = [
      { natural: 60, longestWord: 6 }, // a long title
      { natural: 11, longestWord: 8 }, // "In progress"
      { natural: 21, longestWord: 10 }, // "Rig Inspection Portal"
    ];
    const plan = fitColumns(cols, 500, { size: 9, padX: PAD });
    expect(plan.widths[1]).toBeCloseTo(11 * 9 + PAD * 2, 6);
    expect(plan.widths[2]).toBeCloseTo(21 * 9 + PAD * 2, 6);
    expect(plan.widths[0]).toBeCloseTo(500 - plan.widths[1]! - plan.widths[2]!, 6);
  });

  it('a wide table shrinks its type (in half points, never below the minimum) until every longest word fits', () => {
    const cols: ColumnMeasure[] = Array.from({ length: 10 }, () => ({ natural: 30, longestWord: 7.5 }));
    // 10 × (7.5 × 9 + 10) = 775 > 734 at 9 pt; 10 × (7.5 × 8.5 + 10) = 737.5 > 734; at 8 pt: 700 ≤ 734.
    const plan = fitColumns(cols, 734, { size: 9, minSize: 7, padX: PAD });
    expect(plan.size).toBe(8);
    expect(plan.fits).toBe(true);
    expect(sum(plan.widths)).toBeCloseTo(734, 6);
  });

  it('past the minimum size the columns share the width (words then break inside their cells); the table is never wider than the page', () => {
    const cols: ColumnMeasure[] = Array.from({ length: 14 }, (_, i) => ({ natural: 40, longestWord: i === 0 ? 20 : 8 }));
    const plan = fitColumns(cols, 734, { size: 9, minSize: 7, padX: PAD });
    expect(plan.size).toBe(7);
    expect(plan.fits).toBe(false);
    expect(sum(plan.widths)).toBeCloseTo(734, 6);
    expect(plan.widths[0]).toBeGreaterThan(plan.widths[1]!); // still in proportion to what each needs
  });

  it('without a minimum size the type size never changes', () => {
    const cols: ColumnMeasure[] = Array.from({ length: 10 }, () => ({ natural: 30, longestWord: 9 }));
    expect(fitColumns(cols, 487, { size: 9, padX: PAD }).size).toBe(9);
  });

  it('measures a column’s natural line and its longest word; a column kept on one line counts whole cells; a long link is capped (it may break)', () => {
    const url = 'https://files.example.com/rig-inspection/2026/october/site-visit-photos-batch-0042/originals/IMG_2026.jpg';
    const m = measureColumns(
      [{ header: 'Title' }, { header: 'Due', nowrap: true }, { header: 'Link' }],
      [
        ['Pressure test report for the north manifold', '19 Oct 2026', url],
        ['تحديث مخزون الصمامات', '', ''],
      ],
    );
    expect(m[0]!.natural).toBeCloseTo(measureText('Pressure test report for the north manifold', 1), 3);
    expect(m[0]!.longestWord).toBeCloseTo(Math.max(measureText('manifold', 1), measureText('Pressure', 1), measureText('Title', 1, true)), 3);
    expect(m[1]!.longestWord).toBeCloseTo(measureText('19 Oct 2026', 1), 3);
    expect(m[2]!.natural).toBeCloseTo(measureText(url, 1), 3);
    expect(m[2]!.longestWord).toBeLessThan(measureText(url, 1) / 3);
  });
});

describe('table rows: pages', () => {
  // Line height 10, padding 3 top and bottom: a row of n lines is 10n + 6 tall.
  const base = { lineHeight: 10, padY: 3, header: 16, room: 200, pageRoom: 300, atTop: false };
  const flat = (pages: Array<Array<{ row: number; from: number; to: number }>>) => pages.flat();

  it('keeps every row whole, in order, exactly once; a row that doesn’t fit starts the next page', () => {
    const lines = Array.from({ length: 40 }, (_, i) => 1 + (i % 4));
    const plan = paginateRows(lines, base);
    expect(plan.newPage).toBe(false);
    expect(flat(plan.pages).map((p) => p.row)).toEqual(lines.map((_, i) => i));
    for (const p of flat(plan.pages)) expect([p.from, p.to]).toEqual([0, lines[p.row]]);
    // No page holds more than fits under its header.
    plan.pages.forEach((page, i) => {
      const used = sum(page.map((p) => (p.to - p.from) * 10 + 6));
      expect(used).toBeLessThanOrEqual((i === 0 ? 200 : 300) - 16);
    });
    expect(plan.pages.length).toBeGreaterThan(2);
  });

  it('starts on a new page when the header and the first row don’t fit in what is left', () => {
    const plan = paginateRows([5, 1], { ...base, room: 60 });
    expect(plan.newPage).toBe(true);
    expect(plan.pages[0]!.map((p) => p.row)).toEqual([0, 1]);
  });

  it('at the top of a page it never starts another one, and even a page too short for two lines still moves on (one line a page)', () => {
    const plan = paginateRows([5], { ...base, room: 30, pageRoom: 30, atTop: true });
    expect(plan.newPage).toBe(false);
    expect(flat(plan.pages).map((p) => [p.from, p.to])).toEqual([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
  });

  it('splits a row taller than a page across pages: every line once, in order, none lost', () => {
    const plan = paginateRows([2, 70, 1], base);
    const pieces = flat(plan.pages).filter((p) => p.row === 1);
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces[0]!.from).toBe(0);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]!.from).toBe(pieces[i - 1]!.to);
    expect(pieces[pieces.length - 1]!.to).toBe(70);
    // Each piece fills what is left of its page; the last row follows on the same page.
    plan.pages.forEach((page, i) => {
      const used = sum(page.map((p) => (p.to - p.from) * 10 + 6));
      expect(used).toBeLessThanOrEqual((i === 0 ? 200 : 300) - 16);
    });
    expect(flat(plan.pages).map((p) => p.row)).toEqual([0, ...pieces.map(() => 1), 2]);
    const last = plan.pages[plan.pages.length - 1]!;
    expect(last.map((p) => p.row)).toEqual([1, 2]);
  });

  it('a split row starts on the current page only when at least two of its lines fit there', () => {
    const plan = paginateRows([70], { ...base, room: 16 + 6 + 15 }); // header + one line and a half
    expect(plan.newPage).toBe(true);
    expect(plan.pages[0]![0]!.from).toBe(0);
    expect(plan.pages[0]![0]!.to).toBe(Math.floor((300 - 16 - 6) / 10));
  });
});
