import { describe, it, expect } from 'vitest';
import { dateKey, shiftKey, formatKeyLabel, relativeKeyHint } from './board-date';

describe('board-date helpers', () => {
  it('formats a date key in a time zone', () => {
    // 22:00 UTC on the 9th is already the 10th in Muscat (+4).
    expect(dateKey(new Date('2026-09-09T22:00:00Z'), 'Asia/Muscat')).toBe('2026-09-10');
    expect(dateKey(new Date('2026-09-09T22:00:00Z'), 'UTC')).toBe('2026-09-09');
  });

  it('shifts a key by days across month boundaries', () => {
    expect(shiftKey('2026-09-09', 1)).toBe('2026-09-10');
    expect(shiftKey('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('labels a key and gives a relative hint', () => {
    expect(formatKeyLabel('2026-09-09')).toBe('Wed, Sep 9, 2026');
    expect(relativeKeyHint('2026-09-09', '2026-09-09')).toBe('Today');
    expect(relativeKeyHint('2026-09-08', '2026-09-09')).toBe('Yesterday');
    expect(relativeKeyHint('2026-09-10', '2026-09-09')).toBe('Tomorrow');
    expect(relativeKeyHint('2026-09-01', '2026-09-09')).toBe('');
  });
});
