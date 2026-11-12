import { describe, it, expect, beforeEach } from 'vitest';
import { ARCHIVE_TASK_WORDS, createTaskArchiveService, type ArchivableTask, type TaskArchivePorts } from './task-archive';
import type { TaskActivityEvent } from '../activity/task-activity';

// Task archive (bulk lane, owner 10 Nov): hide but keep. Administrators and the people who run a task's
// project archive and unarchive it (one task or many); every task is checked on its own, and a task the
// person can't open is "not found" — never named.

const T0 = new Date('2026-11-12T08:00:00Z');

function world(opts: { runs?: string[]; archivedProjects?: string[] } = {}) {
  const tasks = new Map<string, ArchivableTask>([
    ['t1', { id: 't1', key: 'RIG-1', title: 'Pour the slab', projectId: 'rig', archivedAt: null }],
    ['t2', { id: 't2', key: 'RIG-2', title: 'Set out', projectId: 'rig', archivedAt: null }],
    ['t3', { id: 't3', key: 'OPS-3', title: 'Order steel', projectId: 'ops', archivedAt: null }],
    ['t4', { id: 't4', key: 'RIG-4', title: 'Old report', projectId: 'rig', archivedAt: new Date('2026-11-01T00:00:00Z') }],
    ['t5', { id: 't5', key: 'FIN-5', title: 'Budget', projectId: 'fin', archivedAt: null }],
    ['t6', { id: 't6', key: 'OLD-6', title: 'Closed', projectId: 'old', archivedAt: null }],
  ]);
  const seen = new Set(['t1', 't2', 't3', 't4', 't6']); // FIN-5 is in a project the person can't open
  const runs = new Set(opts.runs ?? ['rig', 'old']);
  const archivedProjects = new Set(opts.archivedProjects ?? ['old']);
  const activity: TaskActivityEvent[] = [];
  const audit: unknown[] = [];
  const changed: { id: string; archived: boolean }[] = [];
  const ports: TaskArchivePorts = {
    async find(ids) {
      return ids.map((id) => tasks.get(id)).filter((t): t is ArchivableTask => !!t).map((t) => ({ ...t }));
    },
    async canViewTask(actor, id) {
      return actor.roles.includes('ADMIN') || seen.has(id);
    },
    async runsProject(actor, projectId) {
      return actor.roles.includes('ADMIN') || runs.has(projectId);
    },
    async isProjectArchived(projectId) {
      return archivedProjects.has(projectId);
    },
    async setArchived(id, value) {
      const t = tasks.get(id)!;
      if ((t.archivedAt !== null) === (value !== null)) return false;
      t.archivedAt = value ? value.at : null;
      return true;
    },
    recordActivity: async (e) => {
      activity.push(e);
    },
    audit: async (e) => {
      audit.push(e);
    },
    onChanged: async (t, archived) => {
      changed.push({ id: t.id, archived });
    },
    now: () => T0,
  };
  return { service: createTaskArchiveService(ports), tasks, activity, audit, changed };
}

const manager = { id: 'mona', roles: ['EMPLOYEE'] };
const admin = { id: 'admin', roles: ['ADMIN'] };

describe('archive: one task or many, each by its own rule', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it('archives the tasks of projects the person runs: when and by whom, a history line each, one audit line', async () => {
    const r = await w.service.archive(manager, ['t1', 't2']);
    expect(r.done.map((d) => d.key)).toEqual(['RIG-1', 'RIG-2']);
    expect(r.refused).toEqual([]);
    expect(w.tasks.get('t1')!.archivedAt).toEqual(T0);
    expect(w.activity).toEqual([
      { taskId: 't1', userId: 'mona', action: 'ARCHIVED', meta: {} },
      { taskId: 't2', userId: 'mona', action: 'ARCHIVED', meta: {} },
    ]);
    expect(w.audit).toHaveLength(1);
    expect(w.audit[0]).toMatchObject({ userId: 'mona', module: 'tasks', action: 'task.archived', newValue: { count: 2, taskKeys: ['RIG-1', 'RIG-2'] } });
    expect(w.changed).toEqual([{ id: 't1', archived: true }, { id: 't2', archived: true }]);
  });

  it('refuses a task of a project they don’t run — named, as they can open it', async () => {
    const r = await w.service.archive(manager, ['t1', 't3']);
    expect(r.done.map((d) => d.id)).toEqual(['t1']);
    expect(r.refused).toEqual([{ id: 't3', key: 'OPS-3', title: 'Order steel', code: 'FORBIDDEN', message: ARCHIVE_TASK_WORDS.notAllowed }]);
    expect(w.tasks.get('t3')!.archivedAt).toBeNull();
  });

  it('a task they can’t open (or that isn’t there) is “not found”, with nothing about it', async () => {
    const r = await w.service.archive(manager, ['t5', 'nope']);
    expect(r.refused).toEqual([
      { id: 't5', code: 'NOT_FOUND', message: 'Task not found.' },
      { id: 'nope', code: 'NOT_FOUND', message: 'Task not found.' },
    ]);
    expect(w.tasks.get('t5')!.archivedAt).toBeNull();
  });

  it('a task of an archived project is refused (the project is read-only)', async () => {
    const r = await w.service.archive(manager, ['t6']);
    expect(r.refused).toEqual([{ id: 't6', key: 'OLD-6', title: 'Closed', code: 'PROJECT_ARCHIVED', message: 'This project is archived — reopen it first.' }]);
  });

  it('a task already archived is said so, and nothing is written', async () => {
    const r = await w.service.archive(manager, ['t4']);
    expect(r.refused).toEqual([{ id: 't4', key: 'RIG-4', title: 'Old report', code: 'ALREADY_ARCHIVED', message: ARCHIVE_TASK_WORDS.already }]);
    expect(w.activity).toEqual([]);
    expect(w.audit).toEqual([]);
  });

  it('administrators archive any task', async () => {
    const r = await w.service.archive(admin, ['t3', 't5']);
    expect(r.done.map((d) => d.key)).toEqual(['OPS-3', 'FIN-5']);
  });

  it('each task once, however often it is named', async () => {
    const r = await w.service.archive(manager, ['t1', 't1']);
    expect(r.done).toHaveLength(1);
    expect(w.activity).toHaveLength(1);
  });
});

describe('unarchive', () => {
  it('brings an archived task back: a history line, the audit, its views told', async () => {
    const w = world();
    const r = await w.service.unarchive(manager, ['t4']);
    expect(r.done.map((d) => d.key)).toEqual(['RIG-4']);
    expect(w.tasks.get('t4')!.archivedAt).toBeNull();
    expect(w.activity).toEqual([{ taskId: 't4', userId: 'mona', action: 'UNARCHIVED', meta: {} }]);
    expect(w.audit[0]).toMatchObject({ action: 'task.unarchived', newValue: { count: 1, taskKeys: ['RIG-4'] } });
    expect(w.changed).toEqual([{ id: 't4', archived: false }]);
  });

  it('a task that isn’t archived is said so; someone who doesn’t run its project is refused', async () => {
    const w = world({ runs: [] });
    const r = await w.service.unarchive(manager, ['t1', 't4']);
    expect(r.refused).toEqual([
      { id: 't1', key: 'RIG-1', title: 'Pour the slab', code: 'FORBIDDEN', message: ARCHIVE_TASK_WORDS.notAllowed },
      { id: 't4', key: 'RIG-4', title: 'Old report', code: 'FORBIDDEN', message: ARCHIVE_TASK_WORDS.notAllowed },
    ]);
    const w2 = world();
    expect((await w2.service.unarchive(manager, ['t1'])).refused).toEqual([{ id: 't1', key: 'RIG-1', title: 'Pour the slab', code: 'NOT_ARCHIVED', message: ARCHIVE_TASK_WORDS.notArchived }]);
  });
});

describe('plan: what archiving would do, without doing it (the bulk confirmation)', () => {
  it('says which would change and why the others wouldn’t, writing nothing', async () => {
    const w = world();
    const p = await w.service.plan(manager, ['t1', 't3', 't4', 't5'], true);
    expect(p.done.map((d) => d.id)).toEqual(['t1']);
    expect(p.refused.map((r) => [r.id, r.code])).toEqual([
      ['t3', 'FORBIDDEN'],
      ['t4', 'ALREADY_ARCHIVED'],
      ['t5', 'NOT_FOUND'],
    ]);
    expect(w.tasks.get('t1')!.archivedAt).toBeNull();
    expect(w.activity).toEqual([]);
  });
});
