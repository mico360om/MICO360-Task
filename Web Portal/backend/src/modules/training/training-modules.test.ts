import { describe, expect, it } from 'vitest';
import type { LearnerFacts, ModuleFacts } from './training-access';
import { OTHER_UNIT, allUnitsDone, certificateCovers, continueTarget, orderedLessonIds, unitProgress, unitsFor, visibilityWords, type Unit, type UnitLesson } from './training-modules';

const staff = (o: Partial<LearnerFacts> = {}): LearnerFacts => ({ id: 'u', client: false, admin: false, trainingManager: false, runsProject: false, companyIds: ['A'], ...o });
const admin = staff({ admin: true, companyIds: [] });
const employee = staff();

const mod = (id: string, position: number, moduleKey = 'tasks', o: Partial<ModuleFacts> = {}) => ({ id, title: id, position, moduleKey, roleKeys: [], companyIds: [], enabled: true, ...o });
const les = (id: string, moduleId: string | null, kind: UnitLesson['kind'] = 'GUIDE'): UnitLesson => ({ id, kind, moduleId });

describe('unitsFor', () => {
  const modules = [mod('tasks', 1), mod('reports', 2, 'reports'), mod('empty', 3)];
  const lessons = [les('t1', 'tasks'), les('t2', 'tasks', 'QUIZ'), les('r1', 'reports'), les('x1', null)];
  it('shows a person only their modules, then Other lessons', () => {
    expect(unitsFor(modules, lessons, employee).map((u) => u.id)).toEqual(['tasks', OTHER_UNIT]);
    expect(unitsFor(modules, lessons, admin).map((u) => u.id)).toEqual(['tasks', 'reports', OTHER_UNIT]);
  });
  it('orders by position and keeps the lesson order given', () => {
    const u = unitsFor([mod('b', 2), mod('a', 1)], [les('b1', 'b'), les('a2', 'a'), les('a1', 'a')], employee);
    expect(u.map((x) => x.id)).toEqual(['a', 'b']);
    expect(u[0]!.lessonIds).toEqual(['a2', 'a1']);
    expect(orderedLessonIds(u)).toEqual(['a2', 'a1', 'b1']);
  });
  it('a course with no modules has no units', () => {
    expect(unitsFor([], lessons, employee)).toEqual([]);
  });
  it('a lesson pointing at an unknown module is loose', () => {
    const u = unitsFor([mod('tasks', 1)], [les('t1', 'tasks'), les('z', 'gone')], employee);
    expect(u[1]!).toMatchObject({ id: OTHER_UNIT, title: 'Other lessons', position: 2, lessonIds: ['z'] });
  });
});

describe('unitProgress', () => {
  const unit: Unit = { id: 'tasks', title: 'Tasks', position: 1, lessonIds: ['a', 'b', 'q'] };
  const facts = [
    { id: 'a', kind: 'GUIDE' as const, changedVersion: 1 },
    { id: 'b', kind: 'GUIDE' as const, changedVersion: 1 },
    { id: 'q', kind: 'QUIZ' as const, changedVersion: 1 },
  ];
  const d = (s: string) => new Date(s);
  it('not started, in progress, done', () => {
    expect(unitProgress(unit, 'ALL_LESSONS', facts, new Set(), new Map(), null, null)).toMatchObject({ status: 'NOT_STARTED', lessonsDone: 0, lessonCount: 3, doneAt: null });
    expect(unitProgress(unit, 'ALL_LESSONS', facts, new Set(['a', 'b']), new Map(), null, null)).toMatchObject({ status: 'IN_PROGRESS', lessonsDone: 2 });
    const at = new Map([
      ['a', d('2026-11-01')],
      ['b', d('2026-11-03')],
      ['q', d('2026-11-02')],
    ]);
    const done = unitProgress(unit, 'ALL_LESSONS', facts, new Set(['a', 'b', 'q']), at, null, null);
    expect(done.status).toBe('DONE');
    expect(done.doneAt).toEqual(d('2026-11-03'));
  });
  it('a record before the retake start does not count; after it does, even when lessons grew', () => {
    expect(unitProgress(unit, 'ALL_LESSONS', facts, new Set(), new Map(), d('2026-01-01'), d('2026-06-01')).status).toBe('NOT_STARTED');
    const r = unitProgress(unit, 'ALL_LESSONS', facts, new Set(), new Map(), d('2026-07-01'), d('2026-06-01'));
    expect(r.status).toBe('DONE');
    expect(r.doneAt).toEqual(d('2026-07-01'));
  });
  it('allUnitsDone is false for nothing', () => {
    expect(allUnitsDone([])).toBe(false);
    expect(allUnitsDone([{ unitId: 'a', status: 'DONE', lessonsDone: 1, lessonCount: 1, doneAt: null }])).toBe(true);
  });
});

describe('continueTarget', () => {
  const units: Unit[] = [
    { id: 'A', title: 'A', position: 1, lessonIds: ['a1'] },
    { id: 'B', title: 'B', position: 2, lessonIds: ['b1', 'b2', 'b3'] },
    { id: 'C', title: 'C', position: 3, lessonIds: ['c1'] },
  ];
  const p = (unitId: string, status: 'DONE' | 'IN_PROGRESS' | 'NOT_STARTED') => ({ unitId, status, lessonsDone: 0, lessonCount: 1, doneAt: null });
  const progress = [p('A', 'DONE'), p('B', 'IN_PROGRESS'), p('C', 'NOT_STARTED')];
  const done = new Set(['a1', 'b1']);
  it('goes back to the last opened lesson when it is not done and in the first unit to do', () => {
    expect(continueTarget(units, progress, done, 'b3')).toEqual({ unitId: 'B', lessonId: 'b3' });
  });
  it('otherwise the first lesson not done there', () => {
    expect(continueTarget(units, progress, done, 'c1')).toEqual({ unitId: 'B', lessonId: 'b2' });
    expect(continueTarget(units, progress, done, null)).toEqual({ unitId: 'B', lessonId: 'b2' });
    expect(continueTarget(units, progress, done, 'b1')).toEqual({ unitId: 'B', lessonId: 'b2' });
  });
  it('null when everything is done', () => {
    expect(continueTarget(units, [p('A', 'DONE'), p('B', 'DONE'), p('C', 'DONE')], done, 'b1')).toBeNull();
  });
});

describe('certificateCovers', () => {
  it('is true only when the certificate lists every done unit', () => {
    expect(certificateCovers(null, ['a'])).toBe(false);
    expect(certificateCovers(['a', 'b'], ['a'])).toBe(true);
    expect(certificateCovers(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('visibilityWords', () => {
  const names = new Map([
    ['A', 'Contoso Engineering'],
    ['B', 'Fabrikam Logistics'],
  ]);
  const m = (o: Partial<ModuleFacts & { offReason: string | null }> = {}) => ({ moduleKey: 'tasks', roleKeys: [], companyIds: [], enabled: true, ...o });
  it('says who sees it in plain words', () => {
    expect(visibilityWords(m(), names)).toBe('All staff');
    expect(visibilityWords(m({ moduleKey: 'reports' }), names)).toBe('Admins only');
    expect(visibilityWords(m({ moduleKey: 'management' }), names)).toBe('Admins and people who run a project');
    expect(visibilityWords(m({ roleKeys: ['employees'] }), names)).toBe('Employees only');
    expect(visibilityWords(m({ roleKeys: ['training-managers'] }), names)).toBe('Training managers only');
    expect(visibilityWords(m({ roleKeys: ['project-runners'] }), names)).toBe('People who run a project');
    expect(visibilityWords(m({ roleKeys: ['admins', 'project-runners'] }), names)).toBe('Admins or people who run a project');
  });
  it('adds the companies, skipping unknown ones', () => {
    expect(visibilityWords(m({ companyIds: ['A'] }), names)).toBe('All staff · Contoso Engineering');
    expect(visibilityWords(m({ companyIds: ['A', 'zz', 'B'] }), names)).toBe('All staff · Contoso Engineering, Fabrikam Logistics');
  });
  it('says when it is off', () => {
    expect(visibilityWords(m({ enabled: false, offReason: 'REMOVED' }), names)).toBe('Off — the old course was removed');
    expect(visibilityWords(m({ enabled: false }), names)).toBe('Off');
  });
});
