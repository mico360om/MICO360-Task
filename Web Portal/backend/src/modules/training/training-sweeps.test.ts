import { describe, expect, it } from 'vitest';
import { deliverReminders, newestCertificates, reminderCompanyOf, reportsToOf, seesReportsOf } from './training-sweeps';
import type { PersonRecord } from './prisma-training-store';
import type { PlannedNotice } from './training-reminders';

const person = (id: string, o: Partial<PersonRecord> = {}): PersonRecord => ({
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

const N = (key: string, userId: string): PlannedNotice => ({ key, userId, type: 'TRAINING_OVERDUE', title: `T ${userId}`, body: 'B', entityType: 'training-course', entityId: 'c1' });

function fakeKeys(initial: string[] = []) {
  const recorded = new Set(initial);
  const log: string[] = [];
  return {
    recorded,
    log,
    store: {
      async existing(keys: string[]) {
        return new Set(keys.filter((k) => recorded.has(k)));
      },
      async addMany(keys: string[]) {
        for (const k of keys) {
          recorded.add(k);
          log.push(`record ${k}`);
        }
      },
    },
  };
}

describe('sending planned training notices', () => {
  it('records each key BEFORE sending its notices; a key already recorded is never sent again', async () => {
    const keys = fakeKeys(['np:tr:old']);
    const sent: string[] = [];
    const out = await deliverReminders([N('np:tr:a', 'u1'), N('np:tr:a', 'u2'), N('np:tr:old', 'u3'), N('np:tr:b', 'u1')], {
      keys: keys.store,
      notify: async (n) => {
        keys.log.push(`send ${n.userId}`);
        sent.push(n.userId);
      },
    });
    expect(out).toEqual({ sent: 3, fresh: 2 });
    expect(sent).toEqual(['u1', 'u2', 'u1']);
    expect(keys.log).toEqual(['record np:tr:a', 'send u1', 'send u2', 'record np:tr:b', 'send u1']);
  });

  it('one failing send is logged and never stops the others (its key stays recorded)', async () => {
    const keys = fakeKeys();
    const errors: unknown[] = [];
    const sent: string[] = [];
    const out = await deliverReminders([N('np:tr:a', 'bad'), N('np:tr:a', 'ok'), N('np:tr:b', 'ok2')], {
      keys: keys.store,
      notify: async (n) => {
        if (n.userId === 'bad') throw new Error('rules unreadable');
        sent.push(n.userId);
      },
      logger: { info() {}, warn() {}, error: (msg, meta) => errors.push({ msg, meta }) },
    });
    expect(out.sent).toBe(2);
    expect(sent).toEqual(['ok', 'ok2']);
    expect([...keys.recorded].sort()).toEqual(['np:tr:a', 'np:tr:b']);
    expect(errors).toHaveLength(1);
  });

  it('passes the notice as the notification service takes it (no project)', async () => {
    const got: unknown[] = [];
    await deliverReminders([N('np:tr:a', 'u1')], { keys: fakeKeys().store, notify: async (n) => void got.push(n) });
    expect(got).toEqual([{ userId: 'u1', type: 'TRAINING_OVERDUE', title: 'T u1', body: 'B', entityType: 'training-course', entityId: 'c1', projectId: null }]);
  });
});

describe('who and whose rules', () => {
  it('Reports to counts only while it is an active staff account (never themselves)', () => {
    const people = new Map([
      ['boss', person('boss')],
      ['gone', person('gone', { active: false })],
      ['cli', person('cli', { client: true })],
    ]);
    expect(reportsToOf(person('ana', { reportsToId: 'boss' }), people)).toBe('boss');
    expect(reportsToOf(person('ana', { reportsToId: 'gone' }), people)).toBeNull();
    expect(reportsToOf(person('ana', { reportsToId: 'cli' }), people)).toBeNull();
    expect(reportsToOf(person('ana', { reportsToId: 'nobody' }), people)).toBeNull();
    expect(reportsToOf(person('boss', { reportsToId: 'boss' }), people)).toBeNull();
    expect(reportsToOf(person('ana'), people)).toBeNull();
  });

  it('the working days of the primary company while it is one of theirs, else their first company, else the site', () => {
    expect(reminderCompanyOf(person('a', { primaryCompanyId: 'B', companyIds: ['A', 'B'] }))).toBe('B');
    expect(reminderCompanyOf(person('a', { primaryCompanyId: 'Z', companyIds: ['A'] }))).toBe('A');
    expect(reminderCompanyOf(person('a', { primaryCompanyId: null, companyIds: [] }))).toBeNull();
  });

  it('the newest certificate per person and course', () => {
    const rows = [
      { id: 'c1', userId: 'u', courseId: 'k', issuedAt: new Date('2026-01-01') },
      { id: 'c2', userId: 'u', courseId: 'k', issuedAt: new Date('2026-06-01') },
      { id: 'c3', userId: 'u', courseId: 'm', issuedAt: new Date('2026-02-01') },
      { id: 'c4', userId: 'v', courseId: 'k', issuedAt: new Date('2026-03-01') },
    ];
    expect(newestCertificates(rows).map((r) => r.id).sort()).toEqual(['c2', 'c3', 'c4']);
  });
});

describe('M11 who may follow an escalation’s link to the Reports', () => {
  it('an administrator; a Training manager of the learner’s company; whoever runs a project the learner is on — nobody else', () => {
    const ana = person('ana', { companyIds: ['A'], teamProjectIds: ['P1'] });
    expect(seesReportsOf(person('boss', { admin: true }), ana)).toBe(true);
    expect(seesReportsOf(person('tm', { trainingManager: true, companyIds: ['A'] }), ana)).toBe(true);
    expect(seesReportsOf(person('tmB', { trainingManager: true, companyIds: ['B'] }), ana)).toBe(false);
    expect(seesReportsOf(person('pm', { runsProject: true, runProjectIds: ['P1'] }), ana)).toBe(true);
    expect(seesReportsOf(person('pm2', { runsProject: true, runProjectIds: ['P9'] }), ana)).toBe(false);
    expect(seesReportsOf(person('peer'), ana)).toBe(false);
    expect(seesReportsOf(undefined, ana)).toBe(false);
  });
});
