import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { relativeTime } from './relative-time';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe('relativeTime (5c), the website’s “5m ago”', () => {
  it('says just now, minutes, hours and days', () => {
    expect(relativeTime(ago(20_000), NOW)).toBe('just now');
    expect(relativeTime(ago(5 * MIN), NOW)).toBe('5m ago');
    expect(relativeTime(ago(3 * 60 * MIN), NOW)).toBe('3h ago');
    expect(relativeTime(ago(2 * 24 * 60 * MIN), NOW)).toBe('2d ago');
  });

  it('gives the day for anything a week or more old, in the company’s time zone', () => {
    // 14 Oct 21:30 UTC is already 15 Oct in Muscat.
    expect(relativeTime('2026-10-14T21:30:00.000Z', NOW, 'Asia/Muscat')).toBe('15 Oct 2026');
    expect(relativeTime('2026-10-14T21:30:00.000Z', NOW, 'UTC')).toBe('14 Oct 2026');
  });

  it('says nothing for a missing or broken time', () => {
    expect(relativeTime('', NOW)).toBe('');
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});

/** The website's own (Web Portal/frontend/src/lib/relative-time.ts): the same words up to a week. */
const web = resolve(__dirname, '../../../Web Portal/frontend/src/lib/relative-time.ts');
describe.skipIf(!existsSync(web))('the same as the website', () => {
  it('words every time under a week the same way', async () => {
    const { relativeTime: webRelative } = (await import(/* @vite-ignore */ web)) as { relativeTime: (iso: string, now?: number) => string };
    for (const ms of [0, 29_000, 31_000, 59 * MIN, 61 * MIN, 23 * 60 * MIN, 25 * 60 * MIN, 6 * 24 * 60 * MIN]) {
      expect(relativeTime(ago(ms), NOW)).toBe(webRelative(ago(ms), NOW));
    }
    expect(relativeTime('', NOW)).toBe(webRelative('', NOW));
  });
});

describe('one “…ago” in the app (final review B3)', () => {
  it('a task’s activity and comments say it as the Activity and Alerts pages do (the website’s words, the company’s dates)', () => {
    const kit = readFileSync(resolve(__dirname, '../components/task-detail/kit.tsx'), 'utf8');
    expect(kit).toMatch(/export \{ relativeTime \} from '\.\.\/\.\.\/lib\/relative-time';/);
    expect(kit).not.toMatch(/function relativeTime/);
  });
});
