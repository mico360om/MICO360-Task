import { describe, it, expect } from 'vitest';
import { tableFileName, tablePdf, tableXlsx, type TableExport } from './mico-ai-export';
import { inspectXlsx } from '../../lib/xlsx-inspect';
import { inspectPdf } from '../../lib/pdf-inspect';

const ref = (id: string, key: string) => ({ type: 'task' as const, id, label: key, url: `?task=${id}` });
const doc: TableExport = {
  table: {
    title: 'Overdue tasks',
    fromResult: 'r1',
    columns: [
      { key: 'key', label: 'Task', kind: 'key' },
      { key: 'title', label: 'Title' },
      { key: 'assignees', label: 'Assigned to' },
      { key: 'due', label: 'Due', kind: 'date' },
      { key: 'overdueDays', label: 'Overdue', kind: 'days' },
      { key: 'progress', label: 'Progress', kind: 'percent' },
      { key: 'when', label: 'Updated', kind: 'datetime' },
    ],
    rows: [
      { ref: ref('t14', 'RIG-14'), cells: ['RIG-14', 'Pressure test report', 'Omar Said', '2026-10-19', 5, 40, '2026-10-23 11:00'] },
      { ref: ref('t9', 'RIG-9'), cells: ['RIG-9', 'تحديث مخزون الصمامات', 'Sara Ahmed', '2026-10-20', 4, 0, null] },
    ],
  },
  question: 'Which tasks are overdue in Rig Inspection, and who has them?',
  text: '**3 tasks** are overdue.\n- Omar has 2 of them.',
  chatTitle: 'Overdue tasks in Rig Inspection',
  generatedAt: new Date('2026-10-24T08:00:00Z'),
  timeZone: 'Asia/Muscat',
  generatedBy: 'Omar Said',
};

describe('MICO AI downloads', () => {
  it('Excel: the table’s own rows, numbers as numbers and dates as dates, under a title and the question', () => {
    const x = inspectXlsx(tableXlsx(doc));
    expect(x.sheets).toEqual(['Overdue tasks']);
    const text = x.text[0]!;
    for (const s of ['Overdue tasks', 'Task', 'Title', 'Assigned to', 'Due', 'Overdue', 'RIG-14', 'Pressure test report', 'Omar Said', 'تحديث مخزون الصمامات']) expect(text).toContain(s);
    expect(text.some((t) => t.includes('Which tasks are overdue in Rig Inspection, and who has them?'))).toBe(true);
    const sheet = x.parts.get('xl/worksheets/sheet1.xml')!;
    // Overdue days and progress are numbers (5, 4; 40% = 0.4), the due day a real date (19 Oct 2026 = 46314).
    expect(sheet).toMatch(/<v>5<\/v>/);
    expect(sheet).toMatch(/<v>4<\/v>/);
    expect(sheet).toMatch(/<v>0\.4<\/v>/);
    expect(sheet).toMatch(/<v>46314<\/v>/);
  });

  it('PDF: company header, the question, the answer and the table, figures exactly as stored', () => {
    const pdf = inspectPdf(tablePdf(doc));
    const all = pdf.pages.flat().join('\n');
    for (const s of ['Overdue tasks', 'MICO AI', 'Which tasks are overdue in Rig Inspection, and who has them?', '3 tasks are overdue.', 'Omar has 2 of them.', 'RIG-14', 'Pressure test report', '19 Oct 2026', '5 days', '40%', 'Omar Said'])
      expect(all).toContain(s);
    expect(all).not.toContain('**');
    expect(all).toMatch(/Generated 24 Oct 2026, 12:00 \(Asia\/Muscat\) by Omar Said/);
  });

  it('a file name from the table and the company day', () => {
    expect(tableFileName(doc, 'xlsx')).toBe('mico-ai-overdue-tasks-2026-10-24.xlsx');
    expect(tableFileName({ ...doc, table: { ...doc.table, title: 'المهام المتأخرة' } }, 'pdf')).toBe('mico-ai-table-2026-10-24.pdf');
  });
});

describe('MICO AI downloads of a capped list', () => {
  const capped: TableExport = { ...doc, table: { ...doc.table, total: 250 } };
  it('Excel and PDF say “Showing 2 of 250”', () => {
    expect(inspectXlsx(tableXlsx(capped)).text[0]!.some((t) => t.includes('Showing 2 of 250'))).toBe(true);
    expect(inspectPdf(tablePdf(capped)).pages.flat().join('\n')).toContain('Showing 2 of 250');
  });
  it('a complete list says nothing of the kind', () => {
    expect(inspectXlsx(tableXlsx(doc)).text[0]!.some((t) => t.includes('Showing'))).toBe(false);
  });
});
