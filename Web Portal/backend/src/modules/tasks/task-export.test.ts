import { describe, it, expect } from 'vitest';
import { taskSheets, taskPdf, describeActivity, type TaskExportData } from './task-export';
import { inspectPdf } from '../../lib/pdf-inspect';

const ctx = { generatedAt: new Date('2026-10-01T06:00:00Z'), timeZone: 'Asia/Muscat', generatedBy: 'Aisha Khan' };

const task = (over: Partial<TaskExportData> = {}): TaskExportData => ({
  key: 'MICO-42',
  title: 'مراجعة تقرير المبيعات الشهري — monthly sales review',
  description: 'Gather the figures from finance.\nCompare with last month and flag anything over 10%.',
  projectName: 'MICO360 Platform',
  projectCode: 'MICO',
  status: 'In progress',
  category: 'IN_PROGRESS',
  priority: 'HIGH',
  startDate: new Date('2026-09-28T05:00:00Z'),
  dueDate: new Date('2026-10-05T00:00:00Z'),
  completedAt: null,
  createdAt: new Date('2026-09-28T05:00:00Z'),
  updatedAt: new Date('2026-09-30T10:00:00Z'),
  progress: 40,
  estimatedHours: 6,
  actualHours: 2.5,
  createdBy: 'Aisha Khan',
  assignees: ['Omar Ahmed', 'Sara Ahmed'],
  watchers: ['Bilal Ahmed'],
  tags: ['finance', 'monthly'],
  repeat: 'Repeats every month on the last Friday',
  overdue: false,
  checklist: [
    { text: 'Collect figures', done: true },
    { text: 'Write the summary', done: false },
  ],
  blockedBy: [{ key: 'MICO-40', title: 'Close the books', status: 'Done' }],
  blocks: [],
  attachments: [{ filename: 'sales-sep.xlsx', sizeBytes: 48_213, uploadedBy: 'Omar Ahmed', uploadedAt: new Date('2026-09-29T08:15:00Z') }],
  comments: [{ author: 'Omar Ahmed', at: new Date('2026-09-29T08:20:00Z'), body: 'Figures attached. أرقام سبتمبر جاهزة.' }],
  activity: [
    { at: new Date('2026-09-28T05:00:00Z'), who: 'Aisha Khan', action: 'CREATED', meta: { title: 'x' } },
    { at: new Date('2026-09-29T07:00:00Z'), who: 'Aisha Khan', action: 'ASSIGNED', meta: { assignee: 'Omar Ahmed' } },
    { at: new Date('2026-09-30T10:00:00Z'), who: 'Omar Ahmed', action: 'MOVED', meta: { from: 'To do', to: 'In progress' } },
  ],
  ...over,
});

describe('describeActivity', () => {
  it('turns stored actions into sentences', () => {
    expect(describeActivity('CREATED', { recurring: true })).toBe('Created the task (next copy of a repeating task)');
    expect(describeActivity('ASSIGNED', { assignee: 'Omar Ahmed' })).toBe('Assigned Omar Ahmed');
    expect(describeActivity('MOVED', { from: 'To do', to: 'In progress' })).toBe('Moved from To do to In progress');
    expect(describeActivity('COMPLETED', { from: 'Review', to: 'Done' })).toBe('Completed (Review → Done)');
    expect(describeActivity('REOPENED', { from: 'Done', to: 'To do' })).toBe('Reopened (Done → To do)');
    expect(describeActivity('task.something_else', null)).toBe('Task something else');
  });
});

describe('taskSheets', () => {
  it('puts the details on the first sheet and each list on its own sheet', () => {
    const sheets = taskSheets(task(), ctx);
    expect(sheets.map((s) => s.name)).toEqual(['Task', 'Checklist', 'Comments', 'Attachments', 'Dependencies', 'Activity']);
    const details = sheets[0]!;
    expect(details.title).toBe('MICO-42 · مراجعة تقرير المبيعات الشهري — monthly sales review');
    const field = (name: string) => details.rows.find((r) => r[0] === name)?.[1];
    expect(field('Project')).toBe('MICO360 Platform');
    expect(field('Status')).toBe('In progress');
    expect(field('Priority')).toBe('High');
    expect(field('Due')).toBe('5 Oct 2026');
    expect(field('Assignees')).toBe('Omar Ahmed, Sara Ahmed');
    expect(field('Repeat')).toBe('Repeats every month on the last Friday');
    expect(field('Progress')).toBe('40%');
    expect(field('Description')).toContain('Compare with last month');
    expect(sheets[1]!.rows).toEqual([['Done', 'Collect figures'], ['', 'Write the summary']]);
    expect(sheets[2]!.rows[0]).toEqual([{ date: '2026-09-29 12:20' }, 'Omar Ahmed', 'Figures attached. أرقام سبتمبر جاهزة.']);
    expect(sheets[3]!.rows[0]).toEqual(['sales-sep.xlsx', '47.1 KB', 'Omar Ahmed', { date: '2026-09-29 12:15' }]);
    expect(sheets[4]!.rows[0]).toEqual(['Blocked by', 'MICO-40', 'Close the books', 'Done']);
    expect(sheets[5]!.rows.map((r) => r[2])).toEqual(['Created the task', 'Assigned Omar Ahmed', 'Moved from To do to In progress']);
  });
});

describe('taskPdf', () => {
  it('lays out the task with its logo header, details, description and every list', () => {
    const { pages, objects } = inspectPdf(taskPdf(task(), ctx));
    const text = pages.flat();
    // A long title wraps in the header (never clipped): its words all appear, in order.
    expect(text.join(' ')).toContain('مراجعة تقرير المبيعات الشهري — monthly sales review');
    for (const t of ['MICO-42', 'MICO360 Platform', 'In progress', 'High', '5 Oct 2026', 'Open', 'Done', 'Omar Ahmed, Sara Ahmed', 'Repeats every month on the last Friday', 'Description', 'Checklist', 'Collect figures', 'Comments', 'Figures attached. أرقام سبتمبر جاهزة.', 'Attachments', 'sales-sep.xlsx', 'Dependencies', 'MICO-40', 'Activity', 'Moved from To do to In progress']) {
      expect(text, t).toContain(t);
    }
    expect([...objects.values()].some((d) => /\/Subtype \/Image/.test(d))).toBe(true);
    expect(text.some((t) => /^Page 1 of \d+$/.test(t))).toBe(true);
  });

  it('flows a long description and many comments onto further pages without losing any', () => {
    const many = task({
      description: Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: a sentence about the work that needs doing.`).join('\n'),
      comments: Array.from({ length: 40 }, (_, i) => ({ author: 'Omar Ahmed', at: new Date('2026-09-29T08:20:00Z'), body: `Comment ${i + 1}` })),
    });
    const { pages } = inspectPdf(taskPdf(many, ctx));
    expect(pages.length).toBeGreaterThan(2);
    const all = pages.flat();
    for (let i = 1; i <= 60; i++) expect(all.some((t) => t.startsWith(`Paragraph ${i}:`))).toBe(true);
    for (let i = 1; i <= 40; i++) expect(all).toContain(`Comment ${i}`);
    for (const p of pages.slice(1)) expect(p).toContain('MICO-42 · MICO360 Platform');
  });

  it('says when a list is empty and flags an overdue due date', () => {
    const text = inspectPdf(taskPdf(task({ checklist: [], comments: [], attachments: [], blockedBy: [], activity: [], overdue: true }), ctx)).pages.flat();
    expect(text).toContain('No checklist items.');
    expect(text).toContain('No comments yet.');
    expect(text).toContain('5 Oct 2026 · Overdue');
  });
});
