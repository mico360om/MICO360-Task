import { describe, it, expect } from 'vitest';
import { dateKey, shiftKey, formatKeyLabel, relativeKeyHint } from './board-date';

describe('mobile board-date helpers', () => {
  it('formats a date key in a time zone', () => {
    expect(dateKey(new Date('2026-09-09T22:00:00Z'), 'Asia/Muscat')).toBe('2026-09-10');
    expect(dateKey(new Date('2026-09-09T22:00:00Z'), 'UTC')).toBe('2026-09-09');
  });

  it('shifts keys across boundaries', () => {
    expect(shiftKey('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('labels and gives a relative hint', () => {
    expect(formatKeyLabel('2026-09-09')).toBe('Wed, Sep 9');
    expect(relativeKeyHint('2026-09-09', '2026-09-09')).toBe('Today');
    expect(relativeKeyHint('2026-09-08', '2026-09-09')).toBe('Yesterday');
    expect(relativeKeyHint('2026-09-10', '2026-09-09')).toBe('Tomorrow');
    expect(relativeKeyHint('2026-09-05', '2026-09-09')).toBe('');
  });
});
