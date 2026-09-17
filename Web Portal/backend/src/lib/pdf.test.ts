import { describe, it, expect } from 'vitest';
import { toSimplePdf } from './pdf';

const sample = {
  title: 'Project Performance',
  columns: ['projectName', 'total', 'completionPct'],
  rows: [
    { projectName: 'MICO', total: 5, completionPct: 40 },
    { projectName: 'Ops', total: 2, completionPct: 100 },
  ],
};

describe('toSimplePdf', () => {
  it('produces a valid PDF envelope (%PDF header + %%EOF trailer)', () => {
    const pdf = toSimplePdf(sample).toString('latin1');
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('startxref');
  });

  it('embeds the title and cell text in the content stream', () => {
    const pdf = toSimplePdf(sample).toString('latin1');
    expect(pdf).toContain('(Project Performance) Tj');
    expect(pdf).toContain('MICO');
    expect(pdf).toContain('100');
  });

  it('writes an xref whose offsets actually point at each object', () => {
    const pdf = toSimplePdf(sample).toString('latin1');
    const startxref = Number(pdf.match(/startxref\s+(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    // parse the 10-digit offsets (skip the object-0 free entry) and check each points at "N 0 obj"
    const offsets = [...pdf.matchAll(/^(\d{10}) \d{5} n $/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBe(5); // catalog, pages, page, font, contents
    offsets.forEach((off, i) => {
      expect(pdf.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('escapes parentheses and backslashes so text cannot break the stream', () => {
    const pdf = toSimplePdf({ title: 'A (b) \\ c', columns: ['x'], rows: [] }).toString('latin1');
    expect(pdf).toContain('(A \\(b\\) \\\\ c) Tj');
  });
});
