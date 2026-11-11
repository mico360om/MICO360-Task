import { describe, expect, it } from 'vitest';
import { foldGroups, OTHER, parseReportQuery, personInReportScope, quizCourseVisible, reportFilterLines } from './training-report-service';
import type { PersonRecord } from './prisma-training-store';

const P = (id: string, o: Partial<PersonRecord> = {}): PersonRecord => ({
  id,
  name: id,
  email: `${id}@x.test`,
  client: false,
  admin: false,
  trainingManager: false,
  runsProject: false,
  companyIds: ['A'],
  active: true,
  departmentId: null,
  teamProjectIds: [],
  runProjectIds: [],
  createdAt: new Date('2026-01-01'),
  reportsToId: null,
  primaryCompanyId: null,
  tourDoneAt: null,
  ...o,
});

describe('the report’s query', () => {
  it('by course when not said; a course, a period', () => {
    expect(parseReportQuery({})).toEqual({ by: 'course' });
    expect(parseReportQuery({ by: 'person', courseId: 'c1', from: '2026-10-01', to: '2026-10-31' })).toEqual({ by: 'person', courseId: 'c1', from: '2026-10-01', to: '2026-10-31' });
    // Empty values (a cleared filter) mean none.
    expect(parseReportQuery({ by: '', courseId: '', from: '', to: '' })).toEqual({ by: 'course' });
    expect(parseReportQuery({ from: '2026-10-01' })).toEqual({ by: 'course', from: '2026-10-01' });
  });

  it('refuses a bad grouping, a bad day, a period back to front or longer than a year', () => {
    expect(() => parseReportQuery({ by: 'nonsense' })).toThrow();
    expect(() => parseReportQuery({ from: '2026-13-01' })).toThrow();
    expect(() => parseReportQuery({ from: '2026-02-30' })).toThrow();
    expect(() => parseReportQuery({ from: 'yesterday' })).toThrow();
    expect(() => parseReportQuery({ from: '2026-10-31', to: '2026-10-01' })).toThrow(/before/);
    expect(() => parseReportQuery({ from: '2025-01-01', to: '2026-10-01' })).toThrow(/year/);
    expect(() => parseReportQuery({ courseId: 'bad id!' })).toThrow();
  });
});

describe('R5 whose training a report covers', () => {
  const admin = P('admin', { admin: true, companyIds: [] });
  const tm = P('tm', { trainingManager: true, companyIds: ['A'] });
  const runner = P('run', { runsProject: true, runProjectIds: ['P1'], teamProjectIds: ['P1'] });
  it('administrators: everyone, clients too', () => {
    expect(personInReportScope('ALL', admin, P('x', { companyIds: [] }))).toBe(true);
    expect(personInReportScope('ALL', admin, P('c', { client: true }))).toBe(true);
  });
  it('a Training manager: people sharing a company, clients of projects in their companies', () => {
    expect(personInReportScope('COMPANIES', tm, P('a', { companyIds: ['B', 'A'] }))).toBe(true);
    expect(personInReportScope('COMPANIES', tm, P('b', { companyIds: ['B'] }))).toBe(false);
    expect(personInReportScope('COMPANIES', tm, P('c', { client: true, companyIds: ['A'] }))).toBe(true);
    expect(personInReportScope('COMPANIES', tm, P('c2', { client: true, companyIds: ['B'] }))).toBe(false);
  });
  it('a project manager: the teams of the projects they run (themselves included), never clients', () => {
    expect(personInReportScope('TEAM', runner, runner)).toBe(true);
    expect(personInReportScope('TEAM', runner, P('m', { teamProjectIds: ['P2', 'P1'] }))).toBe(true);
    expect(personInReportScope('TEAM', runner, P('o', { teamProjectIds: ['P2'] }))).toBe(false);
    expect(personInReportScope('TEAM', runner, P('c', { client: true, teamProjectIds: ['P1'] }))).toBe(false);
  });
});

describe('the file’s filter lines', () => {
  it('the course and the period in words', () => {
    expect(reportFilterLines({ by: 'course' }, null)).toEqual([]);
    expect(reportFilterLines({ by: 'course', from: '2026-10-01', to: '2026-10-31' }, 'Tasks basics')).toEqual(['Course: Tasks basics', 'Got it from 1 Oct 2026 to 31 Oct 2026']);
    expect(reportFilterLines({ by: 'course', from: '2026-10-01' }, null)).toEqual(['Got it from 1 Oct 2026']);
    expect(reportFilterLines({ by: 'course', to: '2026-10-31' }, null)).toEqual(['Got it until 31 Oct 2026']);
  });
});

describe('M6 a group a reader may not see is folded into “Other”', () => {
  const tm = P('tm', { trainingManager: true, companyIds: ['A'] });
  const runner = P('run', { runsProject: true, runProjectIds: ['P1'], teamProjectIds: ['P1'], companyIds: ['A'] });
  const projectCompanies = new Map([
    ['P1', ['A']],
    ['P2', ['B']],
    ['P3', ['A', 'B']],
  ]);
  it('administrators see every company and project', () => {
    expect(foldGroups('ALL', P('admin', { admin: true }), P('x', { companyIds: ['A', 'B'], teamProjectIds: ['P2'] }), projectCompanies)).toEqual({ companyIds: ['A', 'B'], teamProjectIds: ['P2'] });
  });
  it('a Training manager: her companies, and projects with one of her companies; the rest is “Other” (once)', () => {
    expect(foldGroups('COMPANIES', tm, P('cat', { companyIds: ['A', 'B', 'C'], teamProjectIds: ['P1', 'P2', 'P3'] }), projectCompanies)).toEqual({ companyIds: ['A', OTHER], teamProjectIds: ['P1', 'P3', OTHER] });
    expect(foldGroups('COMPANIES', tm, P('bob', { companyIds: [], teamProjectIds: [] }), projectCompanies)).toEqual({ companyIds: [], teamProjectIds: [] });
  });
  it('a project manager: the projects he runs and his companies', () => {
    expect(foldGroups('TEAM', runner, P('ana', { companyIds: ['A', 'B'], teamProjectIds: ['P1', 'P3'] }), projectCompanies)).toEqual({ companyIds: ['A', OTHER], teamProjectIds: ['P1', OTHER] });
  });
});

describe('M7 whose quizzes a reader sees', () => {
  const course = { audience: 'STAFF', moduleKey: 'admin', roleKeys: null, companyIds: null, status: 'PUBLISHED' };
  it('managers every course; a project manager only courses he may see', () => {
    expect(quizCourseVisible(P('tm', { trainingManager: true }), course)).toBe(true);
    expect(quizCourseVisible(P('admin', { admin: true }), course)).toBe(true);
    expect(quizCourseVisible(P('run', { runsProject: true }), course)).toBe(false);
    expect(quizCourseVisible(P('run', { runsProject: true }), { ...course, moduleKey: 'tasks' })).toBe(true);
    expect(quizCourseVisible(P('run', { runsProject: true }), { ...course, moduleKey: 'portal', audience: 'CLIENTS' })).toBe(false);
  });
});
