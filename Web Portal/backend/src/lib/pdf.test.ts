import { describe, it, expect } from 'vitest';
import { humanizeColumn, toSimplePdf } from './pdf';
import { inspectPdf } from './pdf-inspect';

const sample = {
  title: 'Project Performance',
  columns: ['projectName', 'total', 'completionPct'],
  rows: [
    { projectName: 'MICO', total: 5, completionPct: 40 },
    { projectName: 'Ops', total: 2, completionPct: 100 },
  ],
};

describe('toSimplePdf', () => {
  it('produces a valid PDF envelope (%PDF header + %%EOF trailer) with the title in its metadata', () => {
    const pdf = toSimplePdf(sample).toString('latin1');
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('startxref');
    expect(pdf).toContain('(Project Performance)'); // /Title in the document info
  });

  it('prints the title, humanized headers and every cell', () => {
    const { pages } = inspectPdf(toSimplePdf(sample));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual(
      expect.arrayContaining(['Project Performance', '2 rows', 'Project name', 'Total', 'Completion %', 'MICO', '5', '40', 'Ops', '2', '100']),
    );
  });

  it('keeps special characters intact (no stream corruption, no "?")', () => {
    const { pages } = inspectPdf(toSimplePdf({ title: 'A (b) \\ c', columns: ['x'], rows: [{ x: 'é – “quoted” (x)' }] }));
    expect(pages[0]).toContain('A (b) \\ c');
    expect(pages[0]).toContain('é – “quoted” (x)');
  });

  it('paginates long reports with Arabic names: every row printed, header repeated on each page', () => {
    const names = ['مشروع الميزانية', 'Falcon CRM', 'تطوير البوابة الإلكترونية', 'نظام الموارد البشرية (HR)'];
    const rows = Array.from({ length: 120 }, (_, i) => ({ projectId: `p${i + 1}`, projectName: `${names[i % names.length]} ${i + 1}`, total: i }));
    const { pages } = inspectPdf(toSimplePdf({ title: 'Project Performance', columns: ['projectId', 'projectName', 'total'], rows }));
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const p of pages) expect(p).toEqual(expect.arrayContaining(['Project ID', 'Project name', 'Total']));
    const cells = pages.flat();
    for (const r of rows) {
      expect(cells).toContain(r.projectId);
      expect(cells).toContain(r.projectName);
    }
    expect(cells).toContain('مشروع الميزانية 1');
    expect(pages[0]).toContain(`Page 1 of ${pages.length}`);
  });

  it('renders an empty report with its header and a "no data" note', () => {
    const { pages } = inspectPdf(toSimplePdf({ title: 'User Workload', columns: ['username', 'assigned'], rows: [] }));
    expect(pages[0]).toEqual(expect.arrayContaining(['User Workload', '0 rows', 'Username', 'Assigned', 'No data for this report.']));
  });
});

describe('humanizeColumn', () => {
  it('turns report keys into readable headers', () => {
    expect(humanizeColumn('completionPct')).toBe('Completion %');
    expect(humanizeColumn('projectId')).toBe('Project ID');
    expect(humanizeColumn('username')).toBe('Username');
    expect(humanizeColumn('created_at')).toBe('Created at');
  });
});
