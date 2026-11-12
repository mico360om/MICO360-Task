import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, HttpError } from '../../../lib/http-errors';
import { BULK_UNDO_MS, MAX_BULK_DUPLICATES, MAX_BULK_TASKS, createTaskBulkService, shiftDay, type BulkActor, type BulkRecord, type BulkTask, type TaskBulkPorts } from './task-bulk';
import type { CreateNotificationData } from '../../notifications/notification-repository';

// Bulk task changes (owner, 10 Nov): one change to many tasks, each checked by its own single-task rules;
// a dry run for the confirmation; a summary of changed vs skipped (never naming a task the person can't
// open); a short Undo that leaves alone what changed since; one combined notice per person; one live
// update per project; one audit line.

const T0 = new Date('2026-11-12T08:00:00Z');

const task = (over: Partial<BulkTask> & Pick<BulkTask, 'id' | 'key' | 'projectId'>): BulkTask => ({
  title: `Task ${over.key}`,
  columnId: `${over.projectId}-todo`,
  columnCategory: 'TODO',
  completedAt: null,
  priority: 'NORMAL',
  dueDay: null,
  startDay: null,
  needsApproval: false,
  approvalRequestedAt: null,
  archivedAt: null,
  assigneeIds: [],
  guestIds: [],
  categoryIds: [],
  isMilestone: false,
  ...over,
});

const sara: BulkActor = { id: 'sara', roles: ['EMPLOYEE'] }; // on rig + ops; runs rig
const admin: BulkActor = { id: 'admin', roles: ['ADMIN'] };

function world() {
  let clock = T0;
  const tasks = new Map<string, BulkTask>(
    [
      task({ id: 't1', key: 'RIG-1', projectId: 'rig', assigneeIds: ['omar'], dueDay: '2026-11-20' }),
      task({ id: 't2', key: 'RIG-2', projectId: 'rig', needsApproval: true }),
      task({ id: 't3', key: 'OPS-3', projectId: 'ops', guestIds: ['g1'], assigneeIds: ['omar'] }),
      task({ id: 't4', key: 'FIN-4', projectId: 'fin' }), // Sara can't open Finance
      task({ id: 't5', key: 'OLD-5', projectId: 'old' }), // an archived project
      task({ id: 't6', key: 'RIG-6', projectId: 'rig', archivedAt: new Date('2026-11-01T00:00:00Z') }),
      task({ id: 't7', key: 'RIG-7', projectId: 'rig', columnId: 'rig-done', columnCategory: 'DONE', completedAt: T0 }),
    ].map((t) => [t.id, t]),
  );
  const columns: Record<string, { id: string; name: string; category: string; position: number; enabled: boolean }[]> = {
    rig: [
      { id: 'rig-todo', name: 'To do', category: 'TODO', position: 0, enabled: true },
      { id: 'rig-review', name: 'Review', category: 'REVIEW', position: 1, enabled: true },
      { id: 'rig-done', name: 'Done', category: 'DONE', position: 2, enabled: true },
    ],
    ops: [
      { id: 'ops-todo', name: 'Next', category: 'TODO', position: 0, enabled: true },
      { id: 'ops-done', name: 'Finished', category: 'DONE', position: 1, enabled: true },
    ],
    old: [{ id: 'old-todo', name: 'To do', category: 'TODO', position: 0, enabled: true }],
  };
  const teams: Record<string, string[]> = { rig: ['sara', 'omar', 'nadia'], ops: ['sara', 'omar'], old: ['sara'] };
  const records = new Map<string, BulkRecord>();
  const calls: string[] = [];
  const audits: unknown[] = [];
  const broadcasts: { projectId: string; event: string; payload: unknown }[] = [];
  const delivered: CreateNotificationData[] = [];
  let gathering: CreateNotificationData[] | null = null;
  const notify = (n: CreateNotificationData) => (gathering ? gathering.push(n) : delivered.push(n));
  const deleted = new Set<string>();
  const deletedByOthers = new Set<string>();
  const copies = new Map<string, string>(); // copy → maker
  let n = 0;
  const t = (id: string) => tasks.get(id)!;

  const ports: TaskBulkPorts = {
    async load(ids) {
      return ids.filter((id) => tasks.has(id) && !deleted.has(id)).map((id) => ({ ...t(id), assigneeIds: [...t(id).assigneeIds], guestIds: [...t(id).guestIds], categoryIds: [...t(id).categoryIds] }));
    },
    async canViewProject(actor, p) {
      return actor.roles.includes('ADMIN') || ['rig', 'ops', 'old'].includes(p);
    },
    async projectName(p) {
      return ({ rig: 'Rig 3', ops: 'Operations', old: 'Old Works', fin: 'Finance' })[p] ?? p;
    },
    async isProjectArchived(p) {
      return p === 'old';
    },
    async columnsOf(p) {
      return columns[p] ?? [];
    },
    async canApprove(actor, p) {
      return actor.roles.includes('ADMIN') || (actor.id === 'sara' && p === 'ops');
    },
    async assignableIn(p, ids) {
      return ids.filter((id) => (teams[p] ?? []).includes(id));
    },
    async namesOf(_a, ids) {
      // Only people the person may know: "stranger" stays "Someone".
      return new Map(ids.filter((id) => id !== 'stranger').map((id) => [id, id[0]!.toUpperCase() + id.slice(1)]));
    },
    async categoriesOf(p) {
      return p === 'rig'
        ? { requireCategory: true, categories: [{ id: 'c-civil', name: 'Civil', retired: false }, { id: 'c-old', name: 'Old', retired: true }, { id: 'c-hse', name: 'HSE', retired: false }] }
        : { requireCategory: false, categories: [] };
    },
    async guestsFor(_a, p, ids) {
      return new Map(ids.filter((id) => p === 'ops' && ['g1', 'g2'].includes(id)).map((id) => [id, id]));
    },
    async moveToColumn(actor, id, columnId) {
      calls.push(`move ${id} ${columnId}`);
      const x = t(id);
      const col = Object.values(columns).flat().find((c) => c.id === columnId)!;
      // Approvals: Done by someone who can't approve → waits in Review.
      if (col.category === 'DONE' && x.needsApproval && !(await ports.canApprove(actor, x.projectId))) {
        x.columnId = `${x.projectId}-review`;
        x.columnCategory = 'REVIEW';
        x.approvalRequestedAt = clock;
        x.approvalRequestedById = actor.id;
        notify({ userId: 'nadia', type: 'TASK_APPROVAL', title: 'Approve?', body: x.key, entityType: 'task', entityId: id });
        return { columnId: x.columnId, waits: true };
      }
      x.columnId = columnId;
      x.columnCategory = col.category;
      x.completedAt = col.category === 'DONE' ? T0 : null;
      x.approvalRequestedAt = null;
      x.approvalRequestedById = null;
      for (const u of x.assigneeIds) if (u !== actor.id) notify({ userId: u, type: 'TASK_STATUS', title: 'Moved', body: x.key, entityType: 'task', entityId: id });
      return { columnId, waits: false };
    },
    async withdrawApproval(_a, id) {
      calls.push(`withdraw ${id}`);
      t(id).approvalRequestedAt = null;
    },
    async setPriority(_a, id, p) {
      calls.push(`priority ${id} ${p}`);
      t(id).priority = p;
    },
    async setDueDay(_a, id, day) {
      calls.push(`due ${id} ${day}`);
      t(id).dueDay = day;
    },
    async addPeople(actor, id, ids) {
      calls.push(`add ${id} ${ids.join(',')}`);
      t(id).assigneeIds.push(...ids);
      for (const u of ids) if (u !== actor.id) notify({ userId: u, type: 'TASK_ASSIGNED', title: 'You were assigned a task', body: t(id).key, entityType: 'task', entityId: id });
    },
    async removePerson(_a, id, userId) {
      calls.push(`remove ${id} ${userId}`);
      const x = t(id);
      if (x.guestIds.length && x.assigneeIds.length === 1) throw new HttpError('Guests need a team member.', 'NEEDS_TEAM_MEMBER', 400);
      x.assigneeIds = x.assigneeIds.filter((u) => u !== userId);
    },
    async setCategories(_a, id, ids) {
      calls.push(`categories ${id} ${ids.join(',')}`);
      t(id).categoryIds = [...ids];
    },
    async addGuest(_a, id, g) {
      calls.push(`guest+ ${id} ${g}`);
      t(id).guestIds.push(g);
    },
    async removeGuest(_a, id, g) {
      calls.push(`guest- ${id} ${g}`);
      t(id).guestIds = t(id).guestIds.filter((x) => x !== g);
    },
    move: {
      async preview(_a, ids) {
        return { tasks: ids.map((id) => ({ id, canMove: id !== 't2', reason: id === 't2' ? 'You need to manage Rig 3 to move its tasks.' : null, outsiders: id === 't1' ? [{ id: 'omar' }] : [] })) };
      },
      async move(_a, ids, input) {
        return {
          results: ids.map((id) => {
            if (id === 't2') return { taskId: id, ok: false as const, error: { code: 'FORBIDDEN', message: 'You need to manage Rig 3 to move its tasks.' } };
            const x = t(id);
            x.projectId = input.projectId;
            x.key = `OPS-${++n + 20}`;
            return { taskId: id, ok: true as const, task: { key: x.key, projectId: x.projectId } };
          }),
        };
      },
      async moveBack(_a, id, to) {
        calls.push(`move back ${id} ${to.projectId} ${to.key}`);
        Object.assign(t(id), { projectId: to.projectId, columnId: to.columnId, key: to.key });
      },
    },
    async duplicate(actor, id) {
      const copy = task({ ...t(id), id: `copy${++n}`, key: `${t(id).key.split('-')[0]}-${90 + n}`, title: `${t(id).title} (copy)`, archivedAt: null });
      tasks.set(copy.id, copy);
      copies.set(copy.id, actor.id);
      return { id: copy.id, key: copy.key };
    },
    async eraseCopy(actor, copyId) {
      if (copies.get(copyId) !== actor.id) return false;
      tasks.delete(copyId);
      calls.push(`erase ${copyId}`);
      return true;
    },
    archive: {
      async plan(_a, ids, archiving) {
        return { done: ids.filter((id) => Boolean(t(id).archivedAt) !== archiving && t(id).projectId === 'rig').map((id) => ({ id, key: t(id).key, title: t(id).title, projectId: t(id).projectId })), refused: ids.filter((id) => !(Boolean(t(id).archivedAt) !== archiving && t(id).projectId === 'rig')).map((id) => ({ id, key: t(id).key, title: t(id).title, code: 'FORBIDDEN', message: 'Only administrators and the people who run its project can archive or unarchive its tasks.' })) };
      },
      async archive(a, ids) {
        const p = await ports.archive.plan(a, ids, true);
        for (const d of p.done) Object.assign(t(d.id), { archivedAt: clock, archivedById: a.id });
        return p;
      },
      async unarchive(a, ids) {
        const p = await ports.archive.plan(a, ids, false);
        for (const d of p.done) t(d.id).archivedAt = null;
        return p;
      },
    },
    async deleteRefusal(_a, id) {
      return id === 't3' ? 'Only the person who created this task, or the one person it’s assigned to, can delete it.' : null;
    },
    async deleteTask(_a, id) {
      deleted.add(id);
    },
    async inBinBy(ids) {
      return ids.filter((id) => deleted.has(id) && !deletedByOthers.has(id));
    },
    async restore(_a, ids) {
      for (const id of ids) deleted.delete(id);
      return { restored: ids, refused: [] };
    },
    store: {
      async save(r) {
        const id = `bulk${records.size + 1}`;
        records.set(id, { id, actorId: r.actorId, createdAt: clock, action: r.action, undoUntil: r.undoUntil, undoneAt: null, entries: JSON.parse(JSON.stringify(r.entries)) });
        return id;
      },
      async find(id) {
        return records.get(id) ?? null;
      },
      async claim(id, at) {
        const r = records.get(id)!;
        if (r.undoneAt) return false;
        r.undoneAt = at;
        return true;
      },
    },
    async collectNotices(fn) {
      gathering = [];
      try {
        const result = await fn();
        return { result, notices: gathering };
      } finally {
        gathering = null;
      }
    },
    async deliverNotices(list) {
      // One per person (the real wiring combines them: notice-batch.ts).
      const people = new Map<string, number>();
      for (const x of list) people.set(x.userId, (people.get(x.userId) ?? 0) + 1);
      for (const [userId, count] of people) delivered.push({ userId, type: 'COMBINED', title: `${count}` });
    },
    async audit(e) {
      audits.push(e);
    },
    broadcast(projectId, event, payload) {
      broadcasts.push({ projectId, event, payload });
    },
    now: () => clock,
  };
  return { service: createTaskBulkService(ports), ports, tasks, t, calls, audits, broadcasts, columns, deleted, deletedByOthers, delivered, records, tick: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

describe('a bulk change: each task by its own rules', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it('never names a task the person can’t open (or that isn’t there); an archived project or task is read-only', async () => {
    const r = await w.service.run(sara, { taskIds: ['t1', 't4', 'nope', 't5', 't6'], action: { type: 'priority', priority: 'HIGH' } });
    expect(r.changed.map((c) => c.key)).toEqual(['RIG-1']);
    expect(r.skipped).toEqual([
      { id: 't4', code: 'NOT_FOUND', reason: 'Task not found.' },
      { id: 'nope', code: 'NOT_FOUND', reason: 'Task not found.' },
      { id: 't5', key: 'OLD-5', title: 'Task OLD-5', code: 'PROJECT_ARCHIVED', reason: 'This project is archived — reopen it first.' },
      { id: 't6', key: 'RIG-6', title: 'Task RIG-6', code: 'TASK_ARCHIVED', reason: 'This task is archived — unarchive it first.' },
    ]);
    expect(JSON.stringify(r)).not.toContain('FIN-4');
  });

  it('a dry run says what would happen and writes nothing (no Undo, no audit, no notices, no live update)', async () => {
    const r = await w.service.run(sara, { taskIds: ['t1', 't2'], action: { type: 'priority', priority: 'URGENT' }, dryRun: true });
    expect(r).toMatchObject({ dryRun: true, total: 2, undo: null });
    expect(r.changed.map((c) => c.id)).toEqual(['t1', 't2']);
    expect(w.calls).toEqual([]);
    expect(w.audits).toEqual([]);
    expect(w.broadcasts).toEqual([]);
    expect(w.records.size).toBe(0);
  });

  it('caps: at most 500 tasks, and Duplicate at most 50', async () => {
    const many = Array.from({ length: MAX_BULK_TASKS + 1 }, (_, i) => `x${i}`);
    await expect(w.service.run(sara, { taskIds: many, action: { type: 'priority', priority: 'LOW' } })).rejects.toMatchObject({ status: 400, code: 'TOO_MANY' });
    // The same id twice counts once.
    await expect(w.service.run(sara, { taskIds: [...many.slice(0, 500), 'x0'], action: { type: 'priority', priority: 'LOW' }, dryRun: true })).resolves.toMatchObject({ total: 500 });
    expect(MAX_BULK_DUPLICATES).toBe(20);
    const dupes = Array.from({ length: MAX_BULK_DUPLICATES + 1 }, (_, i) => `x${i}`);
    await expect(w.service.run(sara, { taskIds: dupes, action: { type: 'duplicate' } })).rejects.toMatchObject({ code: 'TOO_MANY' });
  });

  it('status: each task to its own project’s column of that status; Done on a task needing approval waits for approval', async () => {
    const dry = await w.service.run(sara, { taskIds: ['t1', 't2', 't3', 't7'], action: { type: 'status', status: 'DONE' }, dryRun: true });
    expect(dry.changed.map((c) => [c.key, c.note?.code ?? null])).toEqual([
      ['RIG-1', null],
      ['RIG-2', 'WAITS_FOR_APPROVAL'],
      ['OPS-3', null],
    ]);
    expect(dry.skipped).toEqual([{ id: 't7', key: 'RIG-7', title: 'Task RIG-7', code: 'UNCHANGED', reason: 'Already Done.' }]);
    const r = await w.service.run(sara, { taskIds: ['t1', 't2', 't3'], action: { type: 'status', status: 'DONE' } });
    expect(r.changed.find((c) => c.id === 't2')!.note).toEqual({ code: 'WAITS_FOR_APPROVAL', text: 'Waits for approval' });
    expect(w.t('t1').columnId).toBe('rig-done');
    expect(w.t('t2')).toMatchObject({ columnId: 'rig-review', approvalRequestedAt: T0 });
  });

  it('status: a project without that status is skipped and named', async () => {
    const r = await w.service.run(sara, { taskIds: ['t3'], action: { type: 'status', status: 'REVIEW' }, dryRun: true });
    expect(r.skipped).toEqual([{ id: 't3', key: 'OPS-3', title: 'Task OPS-3', code: 'NO_COLUMN', reason: 'Operations has no Review column.' }]);
  });

  it('assign: people not on a task’s project team skip that task, naming them; already assigned is unchanged', async () => {
    const r = await w.service.run(sara, { taskIds: ['t1', 't3'], action: { type: 'assign', userIds: ['nadia'] } });
    expect(r.changed.map((c) => c.key)).toEqual(['RIG-1']);
    expect(r.skipped).toEqual([{ id: 't3', key: 'OPS-3', title: 'Task OPS-3', code: 'NOT_ON_TEAM', reason: 'Nadia isn’t on the Operations team.' }]);
    expect(w.t('t1').assigneeIds).toEqual(['omar', 'nadia']);
    const again = await w.service.run(sara, { taskIds: ['t1'], action: { type: 'assign', userIds: ['nadia'] }, dryRun: true });
    expect(again.skipped[0]!.code).toBe('UNCHANGED');
  });

  it('reassign replaces everyone; unassign leaving a task with guests and no team member is skipped (call 5)', async () => {
    await w.service.run(sara, { taskIds: ['t1'], action: { type: 'reassign', userIds: ['sara'] } });
    expect(w.t('t1').assigneeIds).toEqual(['sara']);
    const r = await w.service.run(sara, { taskIds: ['t1', 't3'], action: { type: 'unassign' } });
    expect(r.changed.map((c) => c.key)).toEqual(['RIG-1']);
    expect(r.skipped).toEqual([{ id: 't3', key: 'OPS-3', title: 'Task OPS-3', code: 'NEEDS_TEAM_MEMBER', reason: 'It has guests, so it needs at least one person from the team.' }]);
    expect(w.t('t3').assigneeIds).toEqual(['omar']);
    // Reassigning a task with guests to someone else keeps a team member all along (added first, then taken off).
    await w.service.run(sara, { taskIds: ['t3'], action: { type: 'reassign', userIds: ['sara'] } });
    expect(w.t('t3').assigneeIds).toEqual(['sara']);
  });

  it('due date: set, clear, shift by days (a task without one is skipped), never before its start', async () => {
    expect(shiftDay('2026-11-30', 2)).toBe('2026-12-02');
    w.t('t2').startDay = '2026-11-25';
    w.t('t2').dueDay = '2026-11-26';
    const r = await w.service.run(sara, { taskIds: ['t1', 't2', 't3'], action: { type: 'dueDate', mode: 'shift', days: -3 } });
    expect(w.t('t1').dueDay).toBe('2026-11-17');
    expect(r.skipped.map((s) => [s.key, s.code])).toEqual([
      ['RIG-2', 'START_AFTER_DUE'],
      ['OPS-3', 'NO_DUE_DATE'],
    ]);
    await w.service.run(sara, { taskIds: ['t1'], action: { type: 'dueDate', mode: 'clear' } });
    expect(w.t('t1').dueDay).toBeNull();
  });

  it('category: one project’s categories; other projects’ tasks skipped; a retired one refused; the project’s rule kept', async () => {
    w.t('t1').categoryIds = ['c-civil'];
    const r = await w.service.run(sara, { taskIds: ['t1', 't2', 't3'], action: { type: 'category', add: ['c-hse'] } });
    expect(r.changed.map((c) => c.key)).toEqual(['RIG-1', 'RIG-2']);
    expect(r.skipped).toEqual([{ id: 't3', key: 'OPS-3', title: 'Task OPS-3', code: 'CATEGORY_OTHER_PROJECT', reason: 'Those categories aren’t Operations’s.' }]);
    const removeAll = await w.service.run(sara, { taskIds: ['t2'], action: { type: 'category', remove: ['c-hse'] }, dryRun: true });
    expect(removeAll.skipped[0]).toMatchObject({ code: 'CATEGORY_REQUIRED', reason: 'Every task in Rig 3 needs a category.' });
    const retired = await w.service.run(sara, { taskIds: ['t1'], action: { type: 'category', add: ['c-old'] }, dryRun: true });
    expect(retired.skipped[0]!.code).toBe('CATEGORY_RETIRED');
    await expect(w.service.run(sara, { taskIds: ['t1'], action: { type: 'category' } })).rejects.toMatchObject({ status: 400 });
  });

  it('guests: from the project’s company list; a task with nobody from the team is skipped', async () => {
    w.t('t3').assigneeIds = ['omar'];
    const r = await w.service.run(sara, { taskIds: ['t3', 't1'], action: { type: 'guests', add: ['g2'] } });
    expect(r.changed.map((c) => c.key)).toEqual(['OPS-3']);
    expect(r.skipped[0]).toMatchObject({ key: 'RIG-1', code: 'GUEST_OTHER_LIST' });
    expect(w.t('t3').guestIds).toEqual(['g1', 'g2']);
  });

  it('project: the move service decides each task; people not on the new team need a choice', async () => {
    const dry = await w.service.run(sara, { taskIds: ['t1', 't2', 't5'], action: { type: 'project', projectId: 'ops' }, dryRun: true });
    expect(dry.changed).toEqual([]);
    expect(dry.skipped.map((s) => [s.key, s.code])).toEqual([
      ['OLD-5', 'PROJECT_ARCHIVED'],
      ['RIG-1', 'ASSIGNEES_NOT_ON_TEAM'],
      ['RIG-2', 'CANT_MOVE'],
    ]);
    const r = await w.service.run(sara, { taskIds: ['t1', 't2'], action: { type: 'project', projectId: 'ops', assignees: 'ADD_TO_TEAM' } });
    expect(r.changed).toEqual([{ id: 't1', key: 'OPS-21', title: 'Task RIG-1', projectId: 'ops' }]);
    expect(r.skipped.map((s) => s.code)).toEqual(['FORBIDDEN']);
    // Both boards hear it once: the new one, and the old one it left.
    expect(w.broadcasts.map((b) => b.projectId).sort()).toEqual(['ops', 'rig']);
  });

  it('duplicate: a copy of each, named in the result; an archived task can be copied', async () => {
    w.t('t1').categoryIds = ['c-civil'];
    w.t('t6').categoryIds = ['c-civil'];
    const r = await w.service.run(sara, { taskIds: ['t1', 't6'], action: { type: 'duplicate' } });
    expect(r.changed.map((c) => [c.key, c.copy?.key])).toEqual([
      ['RIG-1', 'RIG-91'],
      ['RIG-6', 'RIG-92'],
    ]);
  });

  it('archive / unarchive: the archive’s own rules', async () => {
    const r = await w.service.run(sara, { taskIds: ['t1', 't3', 't4'], action: { type: 'archive' } });
    expect(r.changed.map((c) => c.key)).toEqual(['RIG-1']);
    expect(r.skipped.map((s) => [s.id, s.code, s.key ?? null])).toEqual([
      ['t3', 'FORBIDDEN', 'OPS-3'],
      ['t4', 'NOT_FOUND', null],
    ]);
    expect(w.t('t1').archivedAt).toEqual(T0);
  });

  it('delete: the delete rule per task; an archived task can be deleted', async () => {
    const r = await w.service.run(sara, { taskIds: ['t1', 't3', 't6'], action: { type: 'delete' } });
    expect(r.changed.map((c) => c.key)).toEqual(['RIG-1', 'RIG-6']);
    expect(r.skipped[0]).toMatchObject({ key: 'OPS-3', code: 'DELETE_NOT_ALLOWED' });
    expect([...w.deleted]).toEqual(['t1', 't6']);
  });

  it('a refusal from the single-task change becomes that task’s reason; the others go on', async () => {
    const r = await w.service.run(admin, { taskIds: ['t3', 't1'], action: { type: 'unassign', userIds: ['omar'] } });
    // OPS-3 has guests: the plan already says so.
    expect(r.skipped.map((s) => s.code)).toEqual(['NEEDS_TEAM_MEMBER']);
    expect(r.changed.map((c) => c.key)).toEqual(['RIG-1']);
  });

  it('one combined notice per person, one live update per project, one audit line', async () => {
    w.t('t2').assigneeIds = ['omar'];
    await w.service.run(sara, { taskIds: ['t1', 't2', 't3'], action: { type: 'assign', userIds: ['sara'] } });
    expect(w.delivered).toEqual([]); // assigning yourself tells nobody
    await w.service.run(sara, { taskIds: ['t1', 't2', 't3'], action: { type: 'status', status: 'IN_PROGRESS' } });
    expect(w.delivered).toEqual([]); // no such column anywhere: nothing changed
    await w.service.run(sara, { taskIds: ['t1', 't3'], action: { type: 'status', status: 'DONE' } });
    expect(w.delivered).toEqual([{ userId: 'omar', type: 'COMBINED', title: '2' }]);
    expect(w.broadcasts.filter((b) => b.event === 'task:updated').map((b) => [b.projectId, (b.payload as { ids: string[] }).ids])).toContainEqual(['rig', ['t1']]);
    expect(w.audits.at(-1)).toMatchObject({ userId: 'sara', module: 'tasks', action: 'task.bulk.status', newValue: { action: 'status', changed: 2, skipped: 0, taskKeys: ['RIG-1', 'OPS-3'] } });
  });
});

describe('Undo', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it('puts each field back as it was — unless it changed since (left alone, said so)', async () => {
    const r = await w.service.run(sara, { taskIds: ['t1', 't2'], action: { type: 'priority', priority: 'URGENT' } });
    expect(r.undo).toEqual({ id: 'bulk1', until: new Date(T0.getTime() + BULK_UNDO_MS).toISOString() });
    w.t('t2').priority = 'LOW'; // someone changed it since
    const u = await w.service.undo(sara, 'bulk1');
    expect(u.restored.map((x) => x.key)).toEqual(['RIG-1']);
    expect(u.skipped).toEqual([{ id: 't2', key: 'RIG-2', title: 'Task RIG-2', code: 'CHANGED_SINCE', reason: 'Changed since — left as it is.' }]);
    expect(w.t('t1').priority).toBe('NORMAL');
    expect(w.t('t2').priority).toBe('LOW');
  });

  it('only by the person who made it, once, inside its window', async () => {
    await w.service.run(sara, { taskIds: ['t1'], action: { type: 'priority', priority: 'HIGH' } });
    await expect(w.service.undo(admin, 'bulk1')).rejects.toMatchObject({ status: 404 });
    await expect(w.service.undo(sara, 'nope')).rejects.toMatchObject({ status: 404 });
    await w.service.undo(sara, 'bulk1');
    await expect(w.service.undo(sara, 'bulk1')).rejects.toMatchObject({ status: 409, code: 'UNDO_DONE' });
    await w.service.run(sara, { taskIds: ['t1'], action: { type: 'priority', priority: 'LOW' } });
    w.tick(BULK_UNDO_MS + 1);
    await expect(w.service.undo(sara, 'bulk2')).rejects.toMatchObject({ status: 409, code: 'UNDO_EXPIRED' });
  });

  it('a task archived (or out of reach) since is left alone', async () => {
    await w.service.run(sara, { taskIds: ['t1', 't2'], action: { type: 'priority', priority: 'HIGH' } });
    w.t('t1').archivedAt = T0;
    const u = await w.service.undo(sara, 'bulk1');
    expect(u.skipped).toEqual([{ id: 't1', key: 'RIG-1', title: 'Task RIG-1', code: 'TASK_ARCHIVED', reason: 'This task is archived — unarchive it first.' }]);
    expect(w.t('t1').priority).toBe('HIGH');
  });

  it('status back to its column; a task that waited in place has its request withdrawn', async () => {
    await w.service.run(sara, { taskIds: ['t1', 't2'], action: { type: 'status', status: 'DONE' } });
    await w.service.undo(sara, 'bulk1');
    expect(w.t('t1').columnId).toBe('rig-todo');
    expect(w.t('t2')).toMatchObject({ columnId: 'rig-todo', approvalRequestedAt: null });
  });

  it('people, due dates, categories and guests come back', async () => {
    w.t('t1').categoryIds = ['c-civil'];
    await w.service.run(sara, { taskIds: ['t1'], action: { type: 'reassign', userIds: ['nadia'] } });
    await w.service.run(sara, { taskIds: ['t1'], action: { type: 'dueDate', mode: 'set', date: '2026-12-01' } });
    await w.service.run(sara, { taskIds: ['t1'], action: { type: 'category', add: ['c-hse'], remove: ['c-civil'] } });
    await w.service.run(sara, { taskIds: ['t3'], action: { type: 'guests', add: ['g2'] } });
    for (const id of ['bulk1', 'bulk2', 'bulk3', 'bulk4']) await w.service.undo(sara, id);
    expect(w.t('t1')).toMatchObject({ assigneeIds: ['omar'], dueDay: '2026-11-20', categoryIds: ['c-civil'] });
    expect(w.t('t3').guestIds).toEqual(['g1']);
  });

  it('a move goes back to its project, column and number', async () => {
    await w.service.run(sara, { taskIds: ['t1'], action: { type: 'project', projectId: 'ops', assignees: 'ADD_TO_TEAM' } });
    await w.service.undo(sara, 'bulk1');
    expect(w.calls).toContain('move back t1 rig RIG-1');
    expect(w.t('t1')).toMatchObject({ projectId: 'rig', key: 'RIG-1', columnId: 'rig-todo' });
  });

  it('Duplicate: the copies are erased at once; Delete: restored from the Recycle Bin; Archive: unarchived', async () => {
    w.t('t1').categoryIds = ['c-civil'];
    const d = await w.service.run(sara, { taskIds: ['t1'], action: { type: 'duplicate' } });
    await w.service.undo(sara, d.undo!.id);
    expect(w.tasks.has(d.changed[0]!.copy!.id)).toBe(false);
    const del = await w.service.run(sara, { taskIds: ['t1'], action: { type: 'delete' } });
    await w.service.undo(sara, del.undo!.id);
    expect(w.deleted.size).toBe(0);
    const a = await w.service.run(sara, { taskIds: ['t2'], action: { type: 'archive' } });
    const u = await w.service.undo(sara, a.undo!.id);
    expect(u.restored.map((x) => x.key)).toEqual(['RIG-2']);
    expect(w.t('t2').archivedAt).toBeNull();
  });

  it('nothing changed: no Undo is offered', async () => {
    const r = await w.service.run(sara, { taskIds: ['t7'], action: { type: 'status', status: 'DONE' } });
    expect(r.undo).toBeNull();
  });

  it('a conflict while undoing one task is that task’s reason', async () => {
    await w.service.run(sara, { taskIds: ['t1', 't2'], action: { type: 'priority', priority: 'HIGH' } });
    const orig = w.t('t1');
    Object.defineProperty(orig, 'priority', { get: () => 'HIGH', set: () => { throw new ConflictError('This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT'); }, configurable: true });
    const u = await w.service.undo(sara, 'bulk1');
    expect(u.skipped).toEqual([{ id: 't1', key: 'RIG-1', title: 'Task RIG-1', code: 'VERSION_CONFLICT', reason: 'This task was changed by someone else. Reload and try again.' }]);
    expect(u.restored.map((x) => x.key)).toEqual(['RIG-2']);
  });
});

// tbk: the fresh review's findings (I1-I4, M1-M4, M8-M9), each pinned here.
describe('review fixes', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it('I1: a switched-off column is never chosen while the project has others on (Review off: NO_COLUMN)', async () => {
    w.columns.rig!.find((c) => c.id === 'rig-review')!.enabled = false;
    const r = await w.service.run(sara, { taskIds: ['t1'], action: { type: 'status', status: 'REVIEW' }, dryRun: true });
    expect(r.skipped[0]).toMatchObject({ code: 'NO_COLUMN', reason: 'Rig 3 has no Review column.' });
  });

  it('I3: bulk Duplicate makes at most 20 copies a minute per person; the rest are skipped and say so', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const id = `d${i}`;
      w.tasks.set(id, task({ id, key: `RIG-${100 + i}`, projectId: 'rig', categoryIds: ['c-civil'] }));
      ids.push(id);
    }
    const first = await w.service.run(sara, { taskIds: ids.slice(0, 15), action: { type: 'duplicate' } });
    expect(first.changed).toHaveLength(15);
    const second = await w.service.run(sara, { taskIds: ids.slice(15, 25), action: { type: 'duplicate' } });
    expect(second.changed).toHaveLength(5);
    expect(second.skipped.map((s) => s.code)).toEqual(Array(5).fill('TOO_MANY_COPIES'));
    w.tick(61_000);
    expect((await w.service.run(sara, { taskIds: ids.slice(20, 21), action: { type: 'duplicate' } })).changed).toHaveLength(1);
  });

  it('I4: the dry run says what Duplicate would refuse (the project needs a category, it has none to copy)', async () => {
    const r = await w.service.run(sara, { taskIds: ['t1'], action: { type: 'duplicate' }, dryRun: true });
    expect(r.skipped[0]).toMatchObject({ code: 'CATEGORY_REQUIRED' });
    w.t('t1').categoryIds = ['c-civil'];
    expect((await w.service.run(sara, { taskIds: ['t1'], action: { type: 'duplicate' }, dryRun: true })).changed).toHaveLength(1);
  });

  it('I4: the dry run of a move says who can not join the new team, and a task with guests that would lose its team', async () => {
    w.ports.move.preview = async (_a, ids) => ({ tasks: ids.map((id) => ({ id, canMove: true, reason: null, outsiders: [{ id: 'omar', canJoin: id !== 't1' }] })) });
    w.t('t2').guestIds = ['g1'];
    w.t('t2').assigneeIds = ['omar'];
    const add = await w.service.run(sara, { taskIds: ['t1'], action: { type: 'project', projectId: 'ops', assignees: 'ADD_TO_TEAM' }, dryRun: true });
    expect(add.skipped[0]!.code).toBe('CANT_JOIN_TEAM');
    const off = await w.service.run(sara, { taskIds: ['t2'], action: { type: 'project', projectId: 'ops', assignees: 'UNASSIGN' }, dryRun: true });
    expect(off.skipped[0]!.code).toBe('NEEDS_TEAM_MEMBER');
  });

  it('M1: someone the person may not know is "Someone" in a reason', async () => {
    const r = await w.service.run(sara, { taskIds: ['t1'], action: { type: 'assign', userIds: ['stranger'] }, dryRun: true });
    expect(r.skipped[0]!.reason).toBe('Someone isn\u2019t on the Rig 3 team.');
  });

  it('M2: each task is read again just before it changes (archived meanwhile: skipped)', async () => {
    const load = w.ports.load;
    let reads = 0;
    w.ports.load = async (ids) => {
      reads += 1;
      if (reads === 2) w.t('t1').archivedAt = T0; // archived between the first read and its change
      return load(ids);
    };
    const r = await w.service.run(sara, { taskIds: ['t1'], action: { type: 'priority', priority: 'HIGH' } });
    expect(r.skipped[0]).toMatchObject({ code: 'TASK_ARCHIVED' });
    expect(w.t('t1').priority).toBe('NORMAL');
  });

  it('M3: Undo restores only what is still in the bin from this delete; an archive re-done by someone else is left', async () => {
    const del = await w.service.run(sara, { taskIds: ['t1', 't2'], action: { type: 'delete' } });
    w.deletedByOthers.add('t2');
    const u = await w.service.undo(sara, del.undo!.id);
    expect(u.restored.map((x) => x.id)).toEqual(['t1']);
    expect(u.skipped.map((x) => [x.id, x.code])).toEqual([['t2', 'CHANGED_SINCE']]);
    const a = await w.service.run(sara, { taskIds: ['t7'], action: { type: 'archive' } });
    Object.assign(w.t('t7'), { archivedById: 'admin' });
    expect((await w.service.undo(sara, a.undo!.id)).skipped[0]!.code).toBe('CHANGED_SINCE');
  });

  it('M4: an approver\u2019s Done on a waiting task says it approves it; its Undo leaves it (the request is gone)', async () => {
    w.t('t3').needsApproval = true;
    w.t('t3').approvalRequestedAt = T0;
    const dry = await w.service.run(sara, { taskIds: ['t3'], action: { type: 'status', status: 'DONE' }, dryRun: true });
    expect(dry.changed[0]!.note).toEqual({ code: 'APPROVES', text: 'Will be approved' });
    const r = await w.service.run(sara, { taskIds: ['t3'], action: { type: 'status', status: 'DONE' } });
    const u = await w.service.undo(sara, r.undo!.id);
    expect(u.skipped[0]!.code).toBe('APPROVED');
  });

  it('M8: one bulk change at a time per person (a dry run is never held up)', async () => {
    let release!: () => void;
    const slow = w.ports.setPriority;
    w.ports.setPriority = async (...args) => {
      await new Promise<void>((r) => (release = r));
      return slow(...args);
    };
    const first = w.service.run(sara, { taskIds: ['t1'], action: { type: 'priority', priority: 'HIGH' } });
    await new Promise((r) => setTimeout(r, 10));
    await expect(w.service.run(sara, { taskIds: ['t2'], action: { type: 'priority', priority: 'HIGH' } })).rejects.toMatchObject({ status: 409, code: 'BULK_BUSY' });
    await expect(w.service.run(sara, { taskIds: ['t2'], action: { type: 'priority', priority: 'HIGH' }, dryRun: true })).resolves.toBeTruthy();
    release();
    await first;
  });

  it('M9: Undo of a move names the task by its old number', async () => {
    const m = await w.service.run(sara, { taskIds: ['t1'], action: { type: 'project', projectId: 'ops', assignees: 'ADD_TO_TEAM' } });
    const u = await w.service.undo(sara, m.undo!.id);
    expect(u.restored[0]).toMatchObject({ key: 'RIG-1', projectId: 'rig' });
  });
});
