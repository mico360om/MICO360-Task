import { describe, it, expect } from 'vitest';
import { chunkRows } from './chunks';

describe('chunkRows: bulk inserts in pieces well under MySQL’s 16 MB packet', () => {
  it('splits by count', () => {
    const rows = Array.from({ length: 1201 }, (_, i) => ({ i }));
    expect(chunkRows(rows, { maxRows: 500 }).map((c) => c.length)).toEqual([500, 500, 201]);
  });

  it('splits by size: 500 rows of 64 KB descriptions never make one 32 MB statement', () => {
    const rows = Array.from({ length: 500 }, () => ({ description: 'x'.repeat(64 * 1024) }));
    const chunks = chunkRows(rows, { maxRows: 500, maxBytes: 2_000_000 });
    expect(chunks.flat()).toHaveLength(500);
    for (const c of chunks) expect(Buffer.byteLength(JSON.stringify(c))).toBeLessThan(2_100_000);
    expect(chunks.length).toBeGreaterThan(15);
  });

  it('counts bytes, not characters (Arabic text is two bytes a letter)', () => {
    const rows = Array.from({ length: 10 }, () => ({ text: 'ع'.repeat(100_000) }));
    expect(chunkRows(rows, { maxBytes: 450_000 }).map((c) => c.length)).toEqual([2, 2, 2, 2, 2]);
  });

  it('a single row larger than the limit goes on its own', () => {
    expect(chunkRows([{ a: 'x'.repeat(10) }, { a: 'x'.repeat(1000) }, { a: 'y' }], { maxBytes: 100 }).map((c) => c.length)).toEqual([1, 1, 1]);
    expect(chunkRows([], {})).toEqual([]);
  });
});
