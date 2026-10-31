import { it, expect } from 'vitest';
import { DAY_COUNT_FONT_CAP, DAY_HEAD_FONT_CAP } from '../../lib/workload';
import { textWidthEm } from '../../lib/font-metrics';
import { appSource as src } from '../../testing/web-source';

/**
 * Stage 3 final review P8: at the phone's largest font (200%), a Workload day's count ("12", "Off")
 * and heading ("Wed 28 · Today") still fit the day's box — they grow up to a cap, as the calendar's
 * day numbers do; the day's full words are in its TalkBack name (cellLabel). Measured with the
 * app's Plex advances, 10% wider for the bold face.
 */
const BOLD = 1.1;
const width = (t: string, size: number) => textWidthEm(t) * size * BOLD;
/** Lines `text` takes in `room` dp, wrapping between words (Infinity when a word alone doesn't fit). */
function lines(text: string, size: number, room: number): number {
  let n = 1;
  let line = '';
  for (const word of text.split(' ')) {
    if (width(word, size) > room) return Infinity;
    const next = line ? `${line} ${word}` : word;
    if (width(next, size) <= room) line = next;
    else {
      n += 1;
      line = word;
    }
  }
  return n;
}

it('the count fits its cell and the heading its two lines, at 200% as at 100%', () => {
  const card = src('components/workload/PersonCard.tsx');
  // The sizes measured are the card's own.
  expect(card).toMatch(/day: \{ width: 64, minHeight: 56/);
  expect(card).toMatch(/cell: \{ width: 48, minHeight: 44, borderRadius: radius\.input, borderWidth: 1/);
  expect(card).toMatch(/cellOver: \{ borderWidth: 2 \}/);
  expect(card).toMatch(/dayHead: \{ \.\.\.typeStyle\('caption'\), \.\.\.font\('600'\), fontSize: 11, lineHeight: 14/);
  expect(card).toMatch(/count: \{ \.\.\.font\('700'\), fontSize: 15, lineHeight: 20/);
  for (const scale of [1, 1.3, 2]) {
    const count = 15 * Math.min(scale, DAY_COUNT_FONT_CAP);
    for (const v of ['Off', '99']) expect(width(v, count), `${v} at ${scale}`).toBeLessThanOrEqual(48 - 2 * 2);
    expect(20 * Math.min(scale, DAY_COUNT_FONT_CAP), `count line at ${scale}`).toBeLessThanOrEqual(44 - 2 * 2);
    const head = 11 * Math.min(scale, DAY_HEAD_FONT_CAP);
    for (const h of ['Wed 28 · Today', 'Sun 30', 'Thu 29']) expect(lines(h, head, 64), `${h} at ${scale}`).toBeLessThanOrEqual(2);
  }
});

it('the card caps them with those numbers', () => {
  const card = src('components/workload/PersonCard.tsx');
  expect(card).toMatch(/style=\{\[s\.dayHead, isToday && s\.todayText\]\} numberOfLines=\{capLines\(2\)\} maxFontSizeMultiplier=\{DAY_HEAD_FONT_CAP\}/);
  expect(card).toMatch(/style=\{\[s\.count, \{ color: look\.fg \}\]\} maxFontSizeMultiplier=\{DAY_COUNT_FONT_CAP\}/);
});
