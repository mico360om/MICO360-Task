import { describe, expect, it } from 'vitest';
import { assigneeDueDay, enrolmentAfterSync, planAssignmentSync, previewReach, reaches, targetMatches, type AssignmentFacts, type PersonFacts } from './training-targets';
import type { CourseFacts } from './training-access';

const P = (id: string, o: Partial<PersonFacts> = {}): PersonFacts => ({
  id,
  name: `Person ${id}`,
  client: false,
  admin: false,
  trainingManager: false,
  runsProject: false,
  companyIds: ['A'],
  active: true,
  departmentId: null,
  teamProjectIds: [],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...o,
});
const course: CourseFacts = { audience: 'STAFF', moduleKey: 'tasks', roleKeys: [], companyIds: [], status: 'PUBLISHED' };
const A = (o: Partial<AssignmentFacts> = {}): AssignmentFacts => ({
  id: 'as1',
  courseId: 'c1',
  targetKind: 'GROUP',
  targetId: 'everyone',
  mandatory: true,
  dueDay: null,
  dueDays: 14,
  newAccountsOnly: false,
  scopeCompanyIds: null,
  createdAt: new Date('2026-11-01T08:00:00Z'),
  frozen: false,
  ...o,
});

describe('R4 who a target names', () => {
  const ana = P('ana', { departmentId: 'D1', teamProjectIds: ['P1'] });
  const boss = P('boss', { admin: true, companyIds: [] });
  const runner = P('run', { runsProject: true });
  const tm = P('tm', { trainingManager: true });
  const client = P('cli', { client: true });
  it('groups', () => {
    const who = (key: string) => [ana, boss, runner, tm, client].filter((p) => targetMatches({ targetKind: 'GROUP', targetId: key }, p)).map((p) => p.id);
    expect(who('everyone')).toEqual(['ana', 'boss', 'run', 'tm']);
    expect(who('admins')).toEqual(['boss']);
    expect(who('employees')).toEqual(['ana', 'run', 'tm']);
    expect(who('clients')).toEqual(['cli']);
    expect(who('project-runners')).toEqual(['run']);
    expect(who('training-managers')).toEqual(['tm']);
    expect(who('nonsense')).toEqual([]);
  });
  it('a person, a department, a company’s members, a project’s team (never its clients)', () => {
    expect(targetMatches({ targetKind: 'USER', targetId: 'ana' }, ana)).toBe(true);
    expect(targetMatches({ targetKind: 'USER', targetId: 'cli' }, client)).toBe(true);
    expect(targetMatches({ targetKind: 'DEPARTMENT', targetId: 'D1' }, ana)).toBe(true);
    expect(targetMatches({ targetKind: 'DEPARTMENT', targetId: 'D1' }, runner)).toBe(false);
    expect(targetMatches({ targetKind: 'COMPANY', targetId: 'A' }, ana)).toBe(true);
    expect(targetMatches({ targetKind: 'COMPANY', targetId: 'A' }, client)).toBe(false);
    expect(targetMatches({ targetKind: 'PROJECT', targetId: 'P1' }, ana)).toBe(true);
    expect(targetMatches({ targetKind: 'PROJECT', targetId: 'P1' }, P('c2', { client: true, teamProjectIds: ['P1'] }))).toBe(false);
  });
  it('reaches only active people who can see the course, inside the Training manager’s companies, new accounts for rules', () => {
    expect(reaches(A(), course, ana)).toBe(true);
    expect(reaches(A(), course, P('x', { active: false }))).toBe(false);
    expect(reaches(A({ targetId: 'clients' }), course, client)).toBe(false); // a staff course
    expect(reaches(A({ scopeCompanyIds: ['B'] }), course, ana)).toBe(false);
    expect(reaches(A({ scopeCompanyIds: ['A'] }), course, ana)).toBe(true);
    expect(reaches(A({ newAccountsOnly: true }), course, ana)).toBe(false);
    expect(reaches(A({ newAccountsOnly: true }), course, P('new', { createdAt: new Date('2026-11-05T00:00:00Z') }))).toBe(true);
    expect(reaches(A(), { ...course, roleKeys: ['admins'] }, ana)).toBe(false);
  });
});

describe('R6 each person’s due day', () => {
  const created = '2026-11-01';
  it('N days after they got it', () => {
    expect(assigneeDueDay({ dueDay: null, dueDays: 14 }, created, '2026-11-01')).toBe('2026-11-15');
    expect(assigneeDueDay({ dueDay: null, dueDays: 14 }, created, '2026-11-20')).toBe('2026-12-04');
  });
  it('a fixed day: the people there at the start get it; a later joiner the same allowance from joining (at least a day)', () => {
    expect(assigneeDueDay({ dueDay: '2026-11-15', dueDays: null }, created, '2026-11-01')).toBe('2026-11-15');
    expect(assigneeDueDay({ dueDay: '2026-11-15', dueDays: null }, created, '2026-11-10')).toBe('2026-11-24');
    expect(assigneeDueDay({ dueDay: '2026-11-01', dueDays: null }, created, '2026-11-10')).toBe('2026-11-11');
  });
  it('no due date', () => {
    expect(assigneeDueDay({ dueDay: null, dueDays: null }, created, '2026-11-10')).toBeNull();
  });
});

describe('R7 the membership-following sync', () => {
  const people = [P('ana'), P('ben'), P('cat', { companyIds: ['B'] })];
  it('adds the new matches with their own due day, withdraws the leavers, brings a returner back', () => {
    const plan = planAssignmentSync(A({ targetKind: 'COMPANY', targetId: 'A' }), course, people, [
      { id: 'r-ben', userId: 'ben', withdrawnAt: null },
      { id: 'r-cat', userId: 'cat', withdrawnAt: null },
      { id: 'r-dan', userId: 'dan', withdrawnAt: null }, // not among the people looked at: left alone
    ], '2026-11-10');
    expect(plan.add).toEqual([{ userId: 'ana', mandatory: true, dueDay: '2026-11-24' }]);
    expect(plan.withdraw).toEqual([{ assigneeId: 'r-cat', userId: 'cat' }]);
    expect(plan.reactivate).toEqual([]);
    const back = planAssignmentSync(A({ targetKind: 'COMPANY', targetId: 'A' }), course, people, [{ id: 'r-ana', userId: 'ana', withdrawnAt: new Date('2026-11-05') }], '2026-11-10');
    expect(back.reactivate).toEqual([{ assigneeId: 'r-ana', userId: 'ana', dueDay: '2026-11-24' }]);
  });
  it('a frozen assignment (rule switched off), or a course not published, neither adds nor withdraws', () => {
    const rows = [{ id: 'r-cat', userId: 'cat', withdrawnAt: null }];
    for (const plan of [planAssignmentSync(A({ frozen: true }), course, people, rows, '2026-11-10'), planAssignmentSync(A(), { ...course, status: 'DRAFT' }, people, rows, '2026-11-10')]) {
      expect(plan).toEqual({ add: [], reactivate: [], withdraw: [] });
    }
  });
  it('a leaver keeps a finished course; unfinished training with no assignment left (and not started by themselves) is withdrawn', () => {
    expect(enrolmentAfterSync({ completedAt: new Date(), selfStarted: false, withdrawnAt: null }, 0)).toBe('keep');
    expect(enrolmentAfterSync({ completedAt: null, selfStarted: false, withdrawnAt: null }, 0)).toBe('withdraw');
    expect(enrolmentAfterSync({ completedAt: null, selfStarted: true, withdrawnAt: null }, 0)).toBe('keep');
    expect(enrolmentAfterSync({ completedAt: null, selfStarted: false, withdrawnAt: null }, 1)).toBe('keep');
    expect(enrolmentAfterSync({ completedAt: null, selfStarted: false, withdrawnAt: new Date() }, 1)).toBe('restore');
    expect(enrolmentAfterSync({ completedAt: null, selfStarted: false, withdrawnAt: new Date() }, 0)).toBe('keep');
  });
});

describe('the assignment preview', () => {
  it('how many it reaches, who can’t see the course, who has it already', () => {
    const people = [P('ana'), P('ben', { name: 'Ben' }), P('boss', { admin: true, name: 'Boss' })];
    const out = previewReach(A({ targetId: 'everyone' }), { ...course, roleKeys: ['employees'] }, people, new Set(['ana']));
    expect(out).toEqual({ reach: 2, already: 1, skipped: [{ name: 'Boss', reason: 'can’t see this course' }] });
  });
});
