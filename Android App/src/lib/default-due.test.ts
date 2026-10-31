import { describe, it, expect } from 'vitest';
import { defaultDueDay, defaultDueNote } from './default-due';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';

/** A file's text with Windows line ends (CRLF) as plain LF, so a copy compares equal on any checkout. */
const normalise = (text: string) => text.replace(/\r\n/g, '\n');

describe.skipIf(!hasWeb('frontend/src/lib/default-due.ts'))('a copy of the website’s default-due', () => {
  it('is the same text', () => expect(normalise(src('lib/default-due.ts'))).toBe(normalise(readWeb('frontend/src/lib/default-due.ts'))));
});
it('says which day the project gives a new task', () => {
  expect(defaultDueDay({ defaultDueToday: true }, '', '2026-11-03', '2026-10-30')).toBe('2026-11-03');
  expect(defaultDueDay({ defaultDueToday: true }, '2026-11-05', null, '2026-10-30')).toBeNull();
  expect(defaultDueDay({ defaultDueToday: true }, '', '2026-10-28', '2026-10-30')).toBe('2026-10-30');
  expect(defaultDueDay({ defaultDueToday: false }, '', null, '2026-10-30')).toBeNull();
  expect(defaultDueNote('2026-10-30', '2026-10-30')).toBe('Due today (this project’s setting)');
  expect(defaultDueNote('2026-11-03', '2026-10-30')).toBe('Due Tue 3 Nov (this project’s setting)');
  expect(defaultDueNote('2027-01-04', '2026-10-30')).toBe('Due Mon 4 Jan 2027 (this project’s setting)');
});
