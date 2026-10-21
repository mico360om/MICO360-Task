import { describe, it, expect } from 'vitest';
import { parseTags } from './quick-add';

describe('parseTags', () => {
  it('splits on commas, trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(parseTags('urgent, Backend ,urgent,, UX Review')).toEqual(['urgent', 'Backend', 'UX Review']);
  });
  it('splits on the Arabic comma and semicolons too (ARB-04)', () => {
    expect(parseTags('عاجل، مالية')).toEqual(['عاجل', 'مالية']);
    expect(parseTags('a;b؛c,d')).toEqual(['a', 'b', 'c', 'd']);
  });
  it('returns an empty array for blank input', () => {
    expect(parseTags('   ')).toEqual([]);
    expect(parseTags('')).toEqual([]);
  });
});
