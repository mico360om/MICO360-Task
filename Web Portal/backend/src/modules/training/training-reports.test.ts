import { describe, expect, it } from 'vitest';
import { aggregateReport, quizQuestionStats, type ReportEnrolment, type ReportPerson } from './training-reports';
import { drawPaper, seededRng, type StoredQuestion } from './training-quiz';

const people: ReportPerson[] = [
  { id: 'ana', name: 'Ana', client: false, admin: false, departmentId: 'D1', companyIds: ['A'], teamProjectIds: ['P1'] },
  { id: 'ben', name: 'Ben', client: false, admin: true, departmentId: null, companyIds: ['A', 'B'], teamProjectIds: [] },
  { id: 'cli', name: 'Cli', client: true, admin: false, departmentId: null, companyIds: ['A'], teamProjectIds: [] },
];
const E = (userId: string, courseId: string, o: Partial<ReportEnrolment> = {}): ReportEnrolment => ({
  userId,
  courseId,
  status: 'IN_PROGRESS',
  assigned: true,
  started: true,
  overdue: false,
  bestScore: null,
  ...o,
});
const labels = {
  course: new Map([
    ['c1', 'Tasks basics'],
    ['c2', 'Meetings'],
  ]),
  department: new Map([['D1', 'Sales']]),
  company: new Map([
    ['A', 'Alpha'],
    ['B', 'Beta'],
  ]),
  project: new Map([['P1', 'Project One']]),
};
const enrolments = [
  E('ana', 'c1', { status: 'COMPLETED', bestScore: 80 }),
  E('ana', 'c2', { overdue: true }),
  E('ben', 'c1', { status: 'REVIEW', bestScore: 100 }),
  E('cli', 'c1', { status: 'NOT_STARTED', started: false, assigned: false }),
];

describe('report rows', () => {
  it('by course: people, assigned, started, completed (a review still counts), overdue, rates', () => {
    const r = aggregateReport('course', enrolments, people, labels);
    expect(r.rows).toEqual([
      { key: 'c2', label: 'Meetings', people: 1, assigned: 1, started: 1, completed: 0, overdue: 1, completionRate: 0, averageScore: null },
      { key: 'c1', label: 'Tasks basics', people: 3, assigned: 2, started: 2, completed: 2, overdue: 0, completionRate: 67, averageScore: 90 },
    ]);
    expect(r.totals).toEqual({ key: 'all', label: 'All', people: 4, assigned: 3, started: 3, completed: 2, overdue: 1, completionRate: 50, averageScore: 90 });
  });

  it('by person, department, role, company (a person in two companies counts in both) and project', () => {
    expect(aggregateReport('person', enrolments, people, labels).rows.map((r) => [r.label, r.people])).toEqual([
      ['Ana', 2],
      ['Ben', 1],
      ['Cli', 1],
    ]);
    expect(aggregateReport('department', enrolments, people, labels).rows.map((r) => [r.label, r.people])).toEqual([
      ['No department', 2],
      ['Sales', 2],
    ]);
    expect(aggregateReport('role', enrolments, people, labels).rows.map((r) => [r.label, r.people])).toEqual([
      ['Administrators', 1],
      ['Clients', 1],
      ['Employees', 2],
    ]);
    expect(aggregateReport('company', enrolments, people, labels).rows.map((r) => [r.label, r.people])).toEqual([
      ['Alpha', 4],
      ['Beta', 1],
    ]);
    expect(aggregateReport('project', enrolments, people, labels).rows.map((r) => [r.label, r.people])).toEqual([
      ['No project', 2],
      ['Project One', 2],
    ]);
  });

  it('nobody: empty rows, rates unknown', () => {
    const r = aggregateReport('course', [], people, labels);
    expect(r.rows).toEqual([]);
    expect(r.totals).toMatchObject({ people: 0, completionRate: null, averageScore: null });
  });
});

describe('a quiz’s questions', () => {
  it('how often each question was answered and answered right', () => {
    const qs: StoredQuestion[] = [
      { id: 'q1', kind: 'SINGLE', prompt: 'One?', explanation: null, position: 0, options: [{ id: 'a', text: 'A', correct: true, feedback: null, position: 0 }, { id: 'b', text: 'B', correct: false, feedback: null, position: 1 }] },
      { id: 'q2', kind: 'TRUE_FALSE', prompt: 'Two?', explanation: null, position: 1, options: [{ id: 't', text: 'True', correct: true, feedback: null, position: 0 }, { id: 'f', text: 'False', correct: false, feedback: null, position: 1 }] },
    ];
    const paper = drawPaper({ passMark: 50, shuffle: false, drawCount: null }, qs, seededRng(1));
    const onlyQ1 = drawPaper({ passMark: 50, shuffle: false, drawCount: null }, qs.slice(0, 1), seededRng(1));
    const stats = quizQuestionStats(qs, [
      { paper, answers: { q1: ['a'], q2: ['f'] } },
      { paper, answers: { q1: ['b'], q2: ['t'] } },
      { paper: onlyQ1, answers: { q1: ['a'] } },
    ]);
    expect(stats).toEqual([
      { id: 'q1', prompt: 'One?', answered: 3, rightPct: 67 },
      { id: 'q2', prompt: 'Two?', answered: 2, rightPct: 50 },
    ]);
  });
});
