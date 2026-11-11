import { describe, expect, it } from 'vitest';
import { inspectPdf } from '../../lib/pdf-inspect';
import { inspectXlsx } from '../../lib/xlsx-inspect';
import { buildTrainingReportPdf, buildTrainingReportXlsx, trainingReportFileName, type ReportFileMeta } from './training-export';
import type { ReportRow, TrainingReport } from './training-types';

const row = (key: string, label: string, o: Partial<ReportRow> = {}): ReportRow => ({
  key,
  label,
  people: 4,
  assigned: 3,
  started: 3,
  completed: 2,
  overdue: 1,
  completionRate: 50,
  averageScore: 82,
  ...o,
});

const report: TrainingReport = {
  scope: 'COMPANIES',
  by: 'course',
  totals: row('total', 'All courses', { people: 7, completed: 3, completionRate: 43, averageScore: 80 }),
  rows: [row('c1', 'Tasks basics'), row('c2', 'Meetings & minutes', { completionRate: null, averageScore: null, people: 0, assigned: 0, started: 0, completed: 0, overdue: 0 })],
  overdue: [{ userId: 'u1', name: 'Ana Alpha', courseId: 'c1', courseTitle: 'Tasks basics', dueDay: '2026-11-04', daysLate: 5, mandatory: true, client: false }],
  expiring: [{ certificateId: 'x1', userId: 'u2', name: 'Ben Beta', courseId: 'c1', courseTitle: 'Tasks basics', expiresAt: '2026-11-30T08:00:00.000Z' }],
  quizzes: [{ lessonId: 'l1', courseTitle: 'Tasks basics', title: 'Tasks quiz', attempts: 9, passRate: 78, averageScore: 81 }],
};
const empty: TrainingReport = { scope: 'TEAM', by: 'person', totals: row('total', 'Everyone', { people: 0, assigned: 0, started: 0, completed: 0, overdue: 0, completionRate: null, averageScore: null }), rows: [], overdue: [], expiring: [], quizzes: [] };
const meta: ReportFileMeta = { generatedBy: 'Tariq Training', timeZone: 'Asia/Muscat', now: new Date('2026-11-11T08:00:00Z'), filters: ['Course: all courses', '1 Oct 2026 – 31 Oct 2026'] };

describe('training report as Excel', () => {
  it('four sheets: the summary by course (totals too), overdue, certificates expiring, quizzes', () => {
    const x = inspectXlsx(buildTrainingReportXlsx(report, meta));
    expect(x.sheets).toEqual(['Summary', 'Overdue', 'Certificates expiring', 'Quizzes']);
    const [summary, overdue, expiring, quizzes] = x.text.map((t) => t.join(' | '));
    for (const w of ['Training report', 'People in your companies', 'Course: all courses', 'Printed', 'Tariq Training', 'Course', 'Completion rate', 'Average score', 'Tasks basics', 'Meetings & minutes', 'All courses']) expect(summary).toContain(w);
    for (const w of ['Ana Alpha', 'Tasks basics', 'Mandatory', 'Yes', 'No']) expect(overdue).toContain(w);
    expect(expiring).toContain('Ben Beta');
    expect(quizzes).toContain('Tasks quiz');
    // Percentages are real percentages (0–100 in, a fraction stored).
    const sheet1 = x.parts.get('xl/worksheets/sheet1.xml')!;
    expect(sheet1).toContain('<v>0.5</v>');
    expect(sheet1).toContain('<v>0.82</v>');
    // Days are real dates.
    expect(x.parts.get('xl/worksheets/sheet2.xml')!).toMatch(/<v>4\d{4}<\/v>/);
  });

  it('an empty report still opens, each sheet saying it has nothing', () => {
    const x = inspectXlsx(buildTrainingReportXlsx(empty, { ...meta, filters: [] }));
    expect(x.sheets).toHaveLength(4);
    expect(x.text[0]!.join(' | ')).toContain('Your projects’ teams');
    expect(x.text[0]!.join(' | ')).toContain('Person');
  });
});

describe('training report as a PDF (the PDF standard)', () => {
  it('the title, scope, filters, totals, the table by course and the three lists', () => {
    const pdf = inspectPdf(buildTrainingReportPdf(report, { ...meta, company: { companyName: 'Alpha LLC', logo: null } }));
    const text = pdf.pages.map((p) => p.join('\n')).join('\n');
    for (const w of [
      'Training report',
      'By course · People in your companies',
      'Course: all courses',
      'People',
      'Completion rate',
      '43%',
      'Tasks basics',
      'Meetings & minutes',
      'Overdue training',
      'Ana Alpha',
      '4 Nov 2026',
      'Certificates expiring',
      'Ben Beta',
      '30 Nov 2026',
      'Quizzes',
      'Tasks quiz',
      '78%',
      'Alpha LLC',
      'by Tariq Training',
    ]) {
      expect(text).toContain(w);
    }
  });

  it('an empty report says so plainly', () => {
    const text = inspectPdf(buildTrainingReportPdf(empty, meta)).pages.map((p) => p.join('\n')).join('\n');
    expect(text).toContain('By person · Your projects’ teams');
    expect(text).toContain('Nobody has this training yet.');
    expect(text).toContain('No training is overdue.');
    expect(text).toContain('No certificates expire soon.');
    expect(text).toContain('No quiz attempts yet.');
  });
});

describe('file names', () => {
  it('say what it is grouped by and the day', () => {
    expect(trainingReportFileName({ by: 'course' }, 'xlsx', '2026-11-11')).toBe('Training report by course 2026-11-11.xlsx');
    expect(trainingReportFileName({ by: 'department' }, 'pdf', '2026-11-11')).toBe('Training report by department 2026-11-11.pdf');
  });
});
