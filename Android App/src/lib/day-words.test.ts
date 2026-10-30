import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import { clockText, dateTimeText, dayText } from './day-words';

const normalise = (text: string) => text.replace(/\r\n/g, '\n');

describe.skipIf(!hasWeb('frontend/src/lib/day-words.ts'))('a copy of the website’s day-words', () => {
  it('is the same text', () => expect(normalise(src('lib/day-words.ts'))).toBe(normalise(readWeb('frontend/src/lib/day-words.ts'))));
});

it('writes days and times the website’s way, "Sep" never "Sept"', () => {
  expect(dayText('2026-09-05')).toBe('5 Sep 2026');
  expect(dayText('2026-10-30', { weekday: 'short', year: false })).toBe('Fri 30 Oct');
  expect(clockText('2026-10-30T05:05:00Z', 'Asia/Muscat')).toBe('09:05');
  expect(clockText('2026-10-30T20:00:00Z', 'Asia/Muscat')).toBe('00:00');
  expect(dateTimeText('2026-10-10T06:30:00Z', 'Asia/Muscat')).toBe('10 Oct 2026, 10:30');
});
