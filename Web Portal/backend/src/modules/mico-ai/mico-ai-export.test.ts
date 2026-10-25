import { describe, it, expect } from 'vitest';
import { answerFileName, answerPdf, cellText, tableFileName, tablePdf, tableXlsx, type AnswerExport, type TableExport } from './mico-ai-export';
import { inspectXlsx } from '../../lib/xlsx-inspect';
import { inspectPdf } from '../../lib/pdf-inspect';
import { measureText } from '../../lib/pdf-text';

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

// ── A long answer with a wide table: 80 rows × 8 columns, long text, Arabic, an unbroken link, empty cells ──
const URL_TEXT = 'https://files.example.com/rig-inspection/2026/october/site-visit-photos-batch-0042/originals/IMG_2026_10_21_143355.jpg';
const TITLES = [
  'Pressure test report for the north manifold, including the calibration certificates from the vendor',
  'تحديث مخزون الصمامات في الموقع الشمالي ومراجعة الكميات مع المورد',
  `Upload photos ${URL_TEXT}`,
  'Safety checklist v2',
  'Supercalifragilisticexpialidociousandsomemorewordswithoutanyspacesatall',
];
const PEOPLE = ['Omar Said', 'سارة البلوشي', 'Hassan Ahmed, Layla Nasser, Mariam Al-Harthy', '', 'Khurram Shahzad'];
const STATUSES = ['In progress', 'Blocked', 'To do', 'Review', 'Done'];
const big: TableExport = {
  table: {
    title: 'Overdue tasks in Rig Inspection and the platform audit',
    fromResult: 'r1',
    columns: [
      { key: 'key', label: 'Task', kind: 'key' },
      { key: 'title', label: 'Title' },
      { key: 'project', label: 'Project' },
      { key: 'status', label: 'Status' },
      { key: 'assignees', label: 'Assigned to' },
      { key: 'due', label: 'Due', kind: 'date' },
      { key: 'overdueDays', label: 'Overdue', kind: 'days' },
      { key: 'progress', label: 'Progress', kind: 'percent' },
    ],
    rows: Array.from({ length: 80 }, (_, i) => ({
      ref: ref(`t${i + 1}`, `RIG-${i + 1}`),
      cells: [
        `RIG-${i + 1}`,
        `${TITLES[i % TITLES.length]} (#${i + 1})`,
        i % 3 === 0 ? 'Rig Inspection Portal' : 'مشروع فحص المنصات',
        STATUSES[i % STATUSES.length]!,
        PEOPLE[i % PEOPLE.length]!,
        `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        i % 7 === 0 ? null : (i * 3) % 40,
        i % 4 === 0 ? null : (i * 13) % 101,
      ],
    })),
  },
  question: 'Which tasks are overdue in Rig Inspection and the platform audit, who has them, and how far along are they?',
  text: [
    '**80 tasks** are overdue across Rig Inspection Portal and مشروع فحص المنصات.',
    'The oldest are blocked on vendor paperwork.',
    '',
    `See ${URL_TEXT} for the photos.`,
    '- **Omar Said** has 16 of them, mostly pressure tests.',
    '- سارة البلوشي لديها **16** مهمة متأخرة.',
    '',
    'Empty cells mean no progress was entered.',
  ].join('\n'),
  chatTitle: 'Overdue tasks in Rig Inspection and the platform audit, with owners',
  generatedAt: new Date('2026-10-25T05:00:00Z'),
  timeZone: 'Asia/Muscat',
  generatedBy: 'Khurram Shahzad',
  sources: [ref('t1', 'RIG-1'), ref('t2', 'RIG-2'), { type: 'project', id: 'p1', label: 'Rig Inspection Portal', url: '/projects/p1' }],
};
const squash = (s: string) => s.replace(/\s+/g, '');
const HEADERS = ['Task', 'Title', 'Project', 'Status', 'Assigned to', 'Due', 'Overdue', 'Progress'];
const shown = (r: { cells: Array<string | number | null> }) => r.cells.map((v, i) => cellText(big.table.columns[i]!.kind, v));

describe('MICO AI PDF report: a long answer with a wide table', () => {
  const buf = tablePdf(big);
  const pdf = inspectPdf(buf);
  const W = 841.89;
  const H = 595.28;

  it('is landscape A4, and every row of the table is there whole on one page — every cell, in order', () => {
    expect(buf.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
    expect(pdf.pages.length).toBeGreaterThan(2);
    const perPage = pdf.pages.map((p) => squash(p.join('')));
    big.table.rows.forEach((r, i) => {
      const whole = squash(shown(r).join(''));
      expect(perPage.filter((p) => p.includes(whole)).length, `row ${i + 1}`).toBe(1);
    });
    // Each task key is drawn exactly once (no row repeated on two pages).
    const keys = pdf.pages.flat().filter((t) => /^RIG-\d+$/.test(t));
    expect(keys).toEqual(big.table.rows.map((r) => r.cells[0]));
  });

  it('repeats the table’s header row at the top of every page the table runs onto', () => {
    const first = pdf.pages.findIndex((p) => p.includes('RIG-1'));
    for (let p = first; p < pdf.pages.length; p++) {
      const page = pdf.pages[p]!;
      const at = page.indexOf('Task');
      expect(page.slice(at, at + HEADERS.length), `page ${p + 1}`).toEqual(HEADERS);
    }
  });

  it('every page has a header (logo and the chat) and a footer with “Page N of M”, when and by whom', () => {
    const n = pdf.pages.length;
    pdf.lines.forEach((lines, p) => {
      const footer = lines.filter((l) => l.y > H - 50).map((l) => l.text);
      expect(footer, `page ${p + 1}`).toContain(`Page ${p + 1} of ${n}`);
      expect(footer.join(' ')).toContain('Generated 25 Oct 2026, 09:00 (Asia/Muscat) by Khurram Shahzad');
      if (p > 0) expect(lines.filter((l) => l.y < 54).map((l) => l.text).join(' ')).toContain('MICO AI · Overdue tasks in Rig Inspection');
      expect(pdf.contents[p]).toMatch(/\/I\d+ Do/); // the company logo
    });
  });

  it('keeps the page body clear of the header and the footer (nothing overlaps them or runs off the page)', () => {
    pdf.lines.forEach((lines, p) => {
      const body = lines.filter((l) => l.y >= 54 && l.y <= H - 50);
      for (const l of body) {
        expect(l.y, `page ${p + 1}: ${l.text}`).toBeLessThanOrEqual(H - 62);
        if (p > 0) expect(l.y, `page ${p + 1}: ${l.text}`).toBeGreaterThan(54 + 14);
        expect(l.x).toBeGreaterThanOrEqual(54 - 0.5);
        expect(l.x + measureText(l.text, l.size, l.fonts.some((f) => /SemiBold|Bold/.test(f)))).toBeLessThanOrEqual(W - 54 + 0.5);
      }
    });
  });

  it('puts the question and the whole answer — paragraphs, line breaks, bullets, bold and the long link — before the table, then the sources', () => {
    const page1 = pdf.pages[0]!;
    const stream = squash(page1.join(''));
    const q = stream.indexOf(squash(big.question));
    const a = stream.indexOf(squash('80 tasks are overdue across Rig Inspection Portal and مشروع فحص المنصات.'));
    const link = stream.indexOf(squash(`See ${URL_TEXT} for the photos.`));
    const sources = stream.indexOf(squash('Sources: RIG-1 · RIG-2 · Rig Inspection Portal'));
    const table = stream.indexOf(squash(HEADERS.join('')));
    expect(q).toBeGreaterThanOrEqual(0);
    expect(a).toBeGreaterThan(q);
    expect(link).toBeGreaterThan(a);
    expect(sources).toBeGreaterThan(link);
    expect(table).toBeGreaterThan(sources);
    for (const s of ['Omar Said has 16 of them, mostly pressure tests.', 'سارة البلوشي لديها 16 مهمة متأخرة.', 'Empty cells mean no progress was entered.']) expect(stream).toContain(squash(s));
    // A line break inside a paragraph stays a line break (as on the page).
    expect(pdf.lines[0]!.map((l) => l.text)).toContain('The oldest are blocked on vendor paperwork.');
    const bold = pdf.lines[0]!.find((l) => l.text.startsWith('80 tasks are overdue'))!;
    expect(bold.fonts[0]).toMatch(/SemiBold/);
  });

  it('right-aligns the numbers (overdue days, progress) on one edge per column', () => {
    const edges = (re: RegExp) =>
      new Set(
        pdf.lines
          .flat()
          .filter((l) => re.test(l.text))
          .map((l) => Math.round((l.x + measureText(l.text, l.size)) * 2) / 2),
      );
    expect(edges(/^\d+ days?$/).size).toBe(1);
    expect(edges(/^\d+%$/).size).toBe(1);
  });
});

describe('MICO AI PDF report: page shape', () => {
  it('a narrow table stays portrait at the full table size', () => {
    const narrow: TableExport = { ...big, table: { ...big.table, columns: big.table.columns.slice(0, 3), rows: big.table.rows.slice(0, 5).map((r) => ({ ...r, cells: r.cells.slice(0, 3) })) } };
    const out = tablePdf(narrow);
    expect(out.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
    const cell = inspectPdf(out).lines.flat().find((l) => l.text === 'RIG-1')!;
    expect(cell.size).toBe(9);
  });

  it('a very wide table turns landscape and shrinks its type, to no less than 7 pt, before it breaks words', () => {
    const cols = Array.from({ length: 13 }, (_, i) => ({ key: `c${i}`, label: `Column ${i + 1}` }));
    const wide: TableExport = { ...big, table: { title: 'Wide', fromResult: 'r1', columns: cols, rows: [{ ref: null, cells: cols.map((_, i) => `Inspection${i} certificates`) }] } };
    const out = tablePdf(wide);
    expect(out.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
    const cells = inspectPdf(out).lines.flat().filter((l) => /^Inspection\d+\b/.test(l.text));
    expect(cells.map((c) => c.text.split(' ')[0])).toEqual(cols.map((_, i) => `Inspection${i}`)); // no word broken
    for (const c of cells) {
      expect(c.size).toBeLessThan(9);
      expect(c.size).toBeGreaterThanOrEqual(7);
    }
  });

  it('an answer without words or sources still makes a report of the table', () => {
    const bare: TableExport = { ...doc, text: '', sources: [] };
    const all = inspectPdf(tablePdf(bare)).pages.flat();
    expect(all).toEqual(expect.arrayContaining(['RIG-14', 'Pressure test report']));
    expect(all.join(' ')).not.toContain('Sources:');
  });
});

describe('MICO AI Excel download: sources', () => {
  it('lists the answer’s sources under the question', () => {
    expect(inspectXlsx(tableXlsx(big)).text[0]!.some((t) => t === 'Sources: RIG-1 · RIG-2 · Rig Inspection Portal')).toBe(true);
  });
});

// ── The whole answer as one PDF report ──
const asAnswer = (d: TableExport, tables: TableExport['table'][]): AnswerExport => ({
  question: d.question,
  text: d.text,
  tables,
  sources: d.sources ?? [],
  chatTitle: d.chatTitle,
  generatedAt: d.generatedAt,
  timeZone: d.timeZone,
  generatedBy: d.generatedBy,
});
const footerOk = (pdf: ReturnType<typeof inspectPdf>, height: number) => {
  const n = pdf.pages.length;
  pdf.lines.forEach((lines, p) => {
    const footer = lines.filter((l) => l.y > height - 50).map((l) => l.text);
    expect(footer, `page ${p + 1}`).toContain(`Page ${p + 1} of ${n}`);
    expect(footer.join(' ')).toMatch(/Generated .* \(Asia\/Muscat\) by /);
    if (p > 0) expect(lines.filter((l) => l.y < 54).map((l) => l.text).join(' ')).toMatch(/^MICO AI · /);
  });
};

describe('MICO AI answer report: the whole answer as one PDF', () => {
  it('a text-only answer (“Summarize this week’s meetings”): portrait, the question, every paragraph and bullet, the sources', () => {
    const meetings: AnswerExport = {
      ...asAnswer(doc, []),
      question: 'Summarize this week’s meetings',
      text: 'Two meetings this week.\n\n- **Weekly review**, Wed 21 Oct: Omar finishes the pressure test.\n- **Site visit**, Thu 22 Oct: the test moved from rig 2 to rig 3.\n\nNo decisions are waiting.',
      sources: [{ type: 'meeting', id: 'm1', label: 'Weekly review · 21 Oct', url: '/meetings/m1' }],
      chatTitle: 'This week’s meetings',
    };
    const out = answerPdf(meetings);
    expect(out.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
    const pdf = inspectPdf(out);
    const stream = squash(pdf.pages.flat().join(''));
    for (const s of ['This week’s meetings', 'MICO AI report', 'Summarize this week’s meetings', 'Two meetings this week.', 'Weekly review, Wed 21 Oct: Omar finishes the pressure test.', 'Site visit, Thu 22 Oct: the test moved from rig 2 to rig 3.', 'No decisions are waiting.', 'Sources: Weekly review · 21 Oct'])
      expect(stream).toContain(squash(s));
    expect(stream).not.toContain('rows)');
    footerOk(pdf, 841.89);
  });

  it('every table of the answer in order, each under its own heading kept with it, its header row repeated on every page it runs onto; an empty table says so', () => {
    const blocked = { title: 'Blocked tasks', fromResult: 'r3', columns: [{ key: 'key', label: 'Task', kind: 'key' as const }, { key: 'title', label: 'Title' }], rows: [] };
    const report = asAnswer(big, [doc.table, big.table, blocked]);
    const out = answerPdf(report);
    expect(out.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/); // a wide table: the report is landscape
    const pdf = inspectPdf(out);
    const all = squash(pdf.pages.flat().join(''));
    const at = (s: string) => all.indexOf(squash(s));
    const order = ['80 tasks are overdue', 'Sources: RIG-1 · RIG-2 · Rig Inspection Portal', 'Overdue tasks (2 rows)', 'Overdue tasks in Rig Inspection and the platform audit (80 rows)', 'Blocked tasks (0 rows)', 'No rows.'].map(at);
    order.forEach((i) => expect(i).toBeGreaterThanOrEqual(0));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Every row of every table is there, whole on one page.
    const perPage = pdf.pages.map((p) => squash(p.join('')));
    for (const t of [doc.table, big.table]) {
      t.rows.forEach((r, i) => {
        const whole = squash(r.cells.map((v, c) => cellText(t.columns[c]!.kind, v)).join(''));
        expect(perPage.filter((p) => p.includes(whole)).length, `${t.title} row ${i + 1}`).toBe(1);
      });
    }
    // The big table's header row heads every page its rows are on.
    pdf.pages.forEach((page, p) => {
      if (!page.some((t) => /^RIG-\d+$/.test(t))) return;
      const start = page.findIndex((t) => /^RIG-\d+$/.test(t));
      const header = page.slice(0, start);
      const h = header.lastIndexOf('Task');
      expect(h, `page ${p + 1}`).toBeGreaterThanOrEqual(0);
    });
    footerOk(pdf, 595.28);
    // Each heading is on the same page as its table's header row (never alone at a page end).
    for (const heading of ['Overdue tasks (2 rows)', 'Blocked tasks (0 rows)']) {
      const p = pdf.pages.findIndex((page) => squash(page.join('')).includes(squash(heading)));
      const after = squash(pdf.pages[p]!.join('')).split(squash(heading))[1]!;
      expect(after.startsWith('Task'), heading).toBe(true);
    }
  });

  it('one very long answer runs over many pages with nothing lost, a header and footer on each', () => {
    const paragraphs = Array.from({ length: 140 }, (_, i) => `Paragraph ${i + 1}: the pressure test on rig ${i % 7} waits for the calibrated gauge and the vendor’s certificate, so it moves to next week.`);
    const long: AnswerExport = { ...asAnswer(doc, []), text: paragraphs.join('\n\n') };
    const pdf = inspectPdf(answerPdf(long));
    expect(pdf.pages.length).toBeGreaterThan(3);
    // The page bodies in reading order (a paragraph may run on from one page to the next).
    const body = squash(pdf.lines.flatMap((lines) => lines.filter((l) => l.y > 54 && l.y < 841.89 - 50).map((l) => l.text)).join(''));
    paragraphs.forEach((p) => expect(body.split(squash(p)).length - 1, p.slice(0, 14)).toBe(1));
    footerOk(pdf, 841.89);
  });

  it('a file name from the chat and the company day', () => {
    expect(answerFileName(asAnswer(doc, []))).toBe('mico-ai-overdue-tasks-in-rig-inspection-2026-10-24.pdf');
    expect(answerFileName({ ...asAnswer(doc, []), chatTitle: 'المهام المتأخرة', question: 'ما هي المهام المتأخرة؟' })).toBe('mico-ai-answer-2026-10-24.pdf');
  });
});
