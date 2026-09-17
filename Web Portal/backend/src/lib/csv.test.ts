import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('writes a header row from the keys and one row per object', () => {
    const csv = toCsv([
      { name: 'Ada', count: 3 },
      { name: 'Omar', count: 5 },
    ]);
    expect(csv).toBe('name,count\r\nAda,3\r\nOmar,5');
  });

  it('quotes values containing commas, quotes, or newlines', () => {
    const csv = toCsv([{ title: 'Hello, world', note: 'She said "hi"', extra: 'line1\nline2' }]);
    expect(csv).toBe('title,note,extra\r\n"Hello, world","She said ""hi""","line1\nline2"');
  });

  it('renders null/undefined as empty cells', () => {
    const csv = toCsv([{ a: null, b: undefined, c: 0 }]);
    expect(csv).toBe('a,b,c\r\n,,0');
  });

  it('uses an explicit column order when given', () => {
    const csv = toCsv([{ b: 2, a: 1 }], ['a', 'b']);
    expect(csv).toBe('a,b\r\n1,2');
  });

  it('returns just a trailing-newline-free empty string for no rows', () => {
    expect(toCsv([])).toBe('');
    expect(toCsv([], ['a', 'b'])).toBe('a,b');
  });
});
