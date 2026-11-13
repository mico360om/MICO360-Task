import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portabilityProblems } from '../../lib/sql-portability';
import {
  EDITED_NOTICE,
  courseLimitedTo,
  courseNotice,
  defaultModuleKey,
  everyIdOnce,
  moduleInputSchema,
  moduleVisibility,
  notMergedOf,
  removeModuleSchema,
} from './training-manage-modules';
import { copyTitle } from './training-duplicate';
import { stateWithout } from './training-finish';
import type { PairState } from './training-read';

const names = new Map([
  ['A', 'Contoso Engineering'],
  ['B', 'Fabrikam Logistics'],
]);
const m = (o: Partial<{ moduleKey: string; roleKeys: string[]; companyIds: string[]; enabled: boolean; offReason: string | null }> = {}) => ({
  moduleKey: 'general',
  roleKeys: [] as string[],
  companyIds: [] as string[],
  enabled: true,
  offReason: null as string | null,
  ...o,
});

describe('a module’s visibility words', () => {
  it('in a staff course: the same words as everywhere (visibilityWords)', () => {
    expect(moduleVisibility(m(), 'STAFF', names)).toBe('All staff');
    expect(moduleVisibility(m({ moduleKey: 'admin' }), 'STAFF', names)).toBe('Admins only');
    expect(moduleVisibility(m({ roleKeys: ['employees'], companyIds: ['A'] }), 'STAFF', names)).toBe('Employees only · Contoso Engineering');
    expect(moduleVisibility(m({ enabled: false, offReason: 'REMOVED' }), 'STAFF', names)).toBe('Off — the old course was removed');
    expect(moduleVisibility(m({ enabled: false }), 'STAFF', names)).toBe('Off');
  });
  it('in a course for clients: features and staff groups don’t apply, companies do', () => {
    expect(moduleVisibility(m({ moduleKey: 'admin', roleKeys: ['admins'] }), 'CLIENTS', names)).toBe('Clients');
    expect(moduleVisibility(m({ companyIds: ['B', 'zz'] }), 'CLIENTS', names)).toBe('Clients · Fabrikam Logistics');
    expect(moduleVisibility(m({ enabled: false }), 'CLIENTS', names)).toBe('Off');
  });
});

describe('a course’s “limited to” words', () => {
  it('null for all staff and for every client; else the words', () => {
    expect(courseLimitedTo({ audience: 'STAFF', moduleKey: 'tasks', roleKeys: [], companyIds: [] }, names)).toBeNull();
    expect(courseLimitedTo({ audience: 'STAFF', moduleKey: 'reports', roleKeys: [], companyIds: [] }, names)).toBe('Admins only');
    expect(courseLimitedTo({ audience: 'STAFF', moduleKey: 'tasks', roleKeys: ['training-managers'], companyIds: [] }, names)).toBe('Training managers only');
    expect(courseLimitedTo({ audience: 'STAFF', moduleKey: 'tasks', roleKeys: [], companyIds: ['A'] }, names)).toBe('All staff · Contoso Engineering');
    expect(courseLimitedTo({ audience: 'CLIENTS', moduleKey: 'portal', roleKeys: [], companyIds: [] }, names)).toBeNull();
    expect(courseLimitedTo({ audience: 'CLIENTS', moduleKey: 'portal', roleKeys: [], companyIds: ['A', 'B'] }, names)).toBe('Clients · Contoso Engineering, Fabrikam Logistics');
  });
});

describe('the “edited built-in course” notice', () => {
  it('for a course the conversion left as it was, until it is archived', () => {
    const left = notMergedOf({ phase: 'done', notMerged: ['c1', 7, 'c2'] });
    expect([...left]).toEqual(['c1', 'c2']);
    expect(courseNotice({ id: 'c1', status: 'PUBLISHED' }, left)).toBe(EDITED_NOTICE);
    expect(courseNotice({ id: 'c1', status: 'DRAFT' }, left)).toBe(EDITED_NOTICE);
    expect(courseNotice({ id: 'c1', status: 'ARCHIVED' }, left)).toBeNull();
    expect(courseNotice({ id: 'c3', status: 'PUBLISHED' }, left)).toBeNull();
    expect(EDITED_NOTICE).toBe('This built-in course was edited, so it wasn’t merged. Its assignments moved to MICO360 Tasks User Training. Archive it when you’re ready.');
  });
  it('no record (or a broken one): no notice', () => {
    expect(notMergedOf(null).size).toBe(0);
    expect(notMergedOf('x').size).toBe(0);
    expect(notMergedOf({ notMerged: 'c1' }).size).toBe(0);
  });
});

describe('module input', () => {
  it('a title of at most 160 characters; known features and groups', () => {
    expect(moduleInputSchema.parse({ title: '  Tasks ' })).toEqual({ title: 'Tasks' });
    expect(() => moduleInputSchema.parse({ title: '  ' })).toThrow();
    expect(() => moduleInputSchema.parse({ title: 'x'.repeat(161) })).toThrow();
    expect(() => moduleInputSchema.parse({ title: 'A', moduleKey: 'nope' })).toThrow();
    expect(() => moduleInputSchema.parse({ title: 'A', roleKeys: ['bosses'] })).toThrow();
    expect(moduleInputSchema.parse({ title: 'A', moduleKey: 'reports', roleKeys: ['admins'], companyIds: ['c_1'], enabled: false })).toMatchObject({ moduleKey: 'reports', enabled: false });
  });
  it('remove: a module id or null (nothing sent: no module)', () => {
    expect(removeModuleSchema.parse({ moveTo: null })).toEqual({ moveTo: null });
    expect(removeModuleSchema.parse({})).toEqual({ moveTo: null });
    expect(removeModuleSchema.parse({ moveTo: 'm_2' })).toEqual({ moveTo: 'm_2' });
    expect(() => removeModuleSchema.parse({ moveTo: '../x' })).toThrow();
  });
  it('a new module teaches the course’s feature (a course for clients: General)', () => {
    expect(defaultModuleKey({ audience: 'STAFF', moduleKey: 'reports' })).toBe('reports');
    expect(defaultModuleKey({ audience: 'CLIENTS', moduleKey: 'portal' })).toBe('general');
  });
  it('an order lists every module once', () => {
    expect(everyIdOnce(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(everyIdOnce(['a', 'b', 'c'], ['c', 'a'])).toBe(false);
    expect(everyIdOnce(['a', 'b'], ['a', 'a'])).toBe(false);
    expect(everyIdOnce(['a', 'b'], ['a', 'b', 'x'])).toBe(false);
    expect(everyIdOnce(['a', 'b'], ['a', 'x'])).toBe(false);
  });
});

describe('a copy’s title', () => {
  it('“Copy of …”, cut to 160 characters (never inside a character)', () => {
    expect(copyTitle('Tasks basics')).toBe('Copy of Tasks basics');
    expect(copyTitle('  Tasks basics ')).toBe('Copy of Tasks basics');
    const long = copyTitle('x'.repeat(160));
    expect(long).toHaveLength(160);
    expect(long.startsWith('Copy of xxx')).toBe(true);
    expect(copyTitle(`${'y'.repeat(150)}😀😀`)).toBe(`Copy of ${'y'.repeat(150)}😀`);
    expect(copyTitle(`${'y'.repeat(151)}😀😀`)).toBe(`Copy of ${'y'.repeat(151)}`);
  });
});

describe('the live database (MariaDB, statement-based binary log)', () => {
  it('no isolation level is ever asked for; the raw SQL reads alike on MySQL and MariaDB', () => {
    let raw = 0;
    for (const file of ['training-manage-modules.ts', 'training-duplicate.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source, file).not.toMatch(/isolationLevel|SET\s+(SESSION\s+)?TRANSACTION/i);
      for (const m of source.matchAll(/\$queryRaw`([^`]*)`/g)) {
        raw++;
        expect(portabilityProblems(m[1]!.replace(/\$\{[^}]*\}/g, '?')), m[1]).toEqual([]);
      }
    }
    expect(raw).toBeGreaterThan(0);
  });
});

describe('a person without one lesson (the delete impact, batch 4b)', () => {
  const at = new Date('2026-11-10T08:00:00Z');
  const lesson = (id: string, moduleId: string | null, kind: 'GUIDE' | 'QUIZ' = 'GUIDE') => ({ id, kind, changedVersion: 1, position: 0, title: id, minutes: 1, moduleId });
  const unit = (id: string, lessonIds: string[], status: 'DONE' | 'IN_PROGRESS' | 'NOT_STARTED', recordedAt: Date | null = null) => ({
    unitId: id,
    status,
    lessonsDone: 0,
    lessonCount: lessonIds.length,
    doneAt: null,
    unit: { id, title: id, position: 0, lessonIds },
    minutes: 0,
    newForRole: false,
    recordedAt,
  });
  const person = (o: Partial<PairState>): PairState => ({ userId: 'u', courseId: 'c', enrolment: null, done: new Map(), doneIds: new Set(), units: [], modules: [], lessons: [], ...o }) as PairState;

  it('a course with modules: each module worked out again without it, a module left empty gone, a recorded module stays done', () => {
    const lessons = [lesson('a', 'm1'), lesson('b', 'm2'), lesson('c', 'm2'), lesson('d', 'm3')];
    const s = person({
      lessons,
      done: new Map([['b', at]]),
      doneIds: new Set(['b']),
      modules: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] as PairState['modules'],
      units: [unit('m1', ['a'], 'DONE', at), unit('m2', ['b', 'c'], 'IN_PROGRESS'), unit('m3', ['d'], 'NOT_STARTED')],
    });
    const without = stateWithout(s, 'c', 'ALL_LESSONS');
    expect(without.lessons.map((l) => l.id)).toEqual(['a', 'b', 'd']);
    expect(without.units.map((u) => [u.unitId, u.status, u.unit.lessonIds])).toEqual([
      ['m1', 'DONE', ['a']],
      ['m2', 'DONE', ['b']],
      ['m3', 'NOT_STARTED', ['d']],
    ]);
    expect(stateWithout(s, 'd', 'ALL_LESSONS').units.map((u) => u.unitId)).toEqual(['m1', 'm2']);
    expect(s.units).toHaveLength(3);
  });
  it('a course without modules: only the lesson goes', () => {
    const s = person({ lessons: [lesson('a', null), lesson('b', null)] });
    const without = stateWithout(s, 'a', 'ALL_LESSONS');
    expect(without.lessons.map((l) => l.id)).toEqual(['b']);
    expect(without.units).toEqual([]);
  });
});
