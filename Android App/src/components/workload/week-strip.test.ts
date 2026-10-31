import { it, expect } from 'vitest';
import { WEEK_STRIP, stripEdges, todayScrollX } from '../../lib/workload';
import { appSource as src } from '../../testing/web-source';

/**
 * Device check F (31 Oct): Workload opened every person's days on Sunday with today off-screen, and
 * nothing said the row scrolls. Each row now opens with today in view — as the first day shown, as
 * far as the row scrolls — and fades at an edge where more days are hidden.
 */
const WEEK = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
const CONTENT = 7 * 64 + 6 * 6; // 484

it('a day column is 64 dp with 6 dp between them', () => {
  expect(WEEK_STRIP).toEqual({ day: 64, gap: 6 });
});

it('opens on today: the first day shown, as far as the row scrolls', () => {
  expect(todayScrollX(WEEK, '2026-10-31', 294)).toBe(CONTENT - 294); // Saturday: the row's end
  expect(todayScrollX(WEEK, '2026-10-28', 294)).toBe(Math.min(3 * 70, CONTENT - 294)); // Wednesday
  expect(todayScrollX(WEEK, '2026-10-26', 294)).toBe(70); // Monday: Sunday is a swipe back
  expect(todayScrollX(WEEK, '2026-10-25', 294)).toBe(0);
  expect(todayScrollX(WEEK, '2026-11-02', 294)).toBe(0); // another week: its start
  expect(todayScrollX(WEEK, '2026-10-31', 600)).toBe(0); // all seven fit
  expect(todayScrollX(WEEK, '2026-10-31', 0)).toBe(0); // not measured yet
});

it('fades the edge where more days are hidden', () => {
  expect(stripEdges(0, CONTENT, 294)).toEqual({ before: false, after: true });
  expect(stripEdges(CONTENT - 294, CONTENT, 294)).toEqual({ before: true, after: false });
  expect(stripEdges(100, CONTENT, 294)).toEqual({ before: true, after: true });
  expect(stripEdges(0, CONTENT, 600)).toEqual({ before: false, after: false });
  expect(stripEdges(0.5, CONTENT, CONTENT - 0.5)).toEqual({ before: false, after: false }); // within a dp
});

it('the person card scrolls each row to today once it is measured, and draws the fades', () => {
  const card = src('components/workload/PersonCard.tsx');
  expect(card).toMatch(/day: \{ width: WEEK_STRIP\.day,/);
  expect(card).toMatch(/days: \{ gap: WEEK_STRIP\.gap,/);
  // Keyed by the week its days are for — not the week asked for: while the next week loads, the
  // page still shows this week's days (placeholder), which would open on today and keep that scroll
  // for the next week's days (re-check F, 31 Oct). Another week opens on its first day (x = 0).
  expect(card).toMatch(/const dates = person\.days\.map\(\(d\) => d\.date\);/);
  expect(card).toMatch(/<DaysRow key=\{dates\[0\] \?\? week\} dates=\{dates\} today=\{today\}>/);
  expect(card).toMatch(/const x = todayScrollX\(dates, today, viewport\);\s*scroll\.current\?\.scrollTo\(\{ x, animated: false \}\);/);
  expect(card).toMatch(/stripEdges\(/);
  expect(card).toMatch(/hexToRgba\(c\.surface, 0\)/);
  expect(card).toMatch(/<LinearGradient[^>]*pointerEvents="none"/);
});
