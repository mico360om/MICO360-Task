import { describe, it, expect, beforeEach } from 'vitest';
import { createTaskService } from './task-service';
import { TaskKeyConflictError, type ColumnInfo, type CreateTaskData, type TaskRecord, type TaskRepository, type ProjectLookup } from './task-repository';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';

// Columns c1/c2/done belong to p1; x1 belongs to p2.
const COLUMNS: Record<string, ColumnInfo> = {
  c1: { id: 'c1', projectId: 'p1', category: 'TODO' },
  c2: { id: 'c2', projectId: 'p1', category: 'IN_PROGRESS' },
  done: { id: 'done', projectId: 'p1', category: 'DONE' },
  done2: { id: 'done2', projectId: 'p1', category: 'DONE' },
  x1: { id: 'x1', projectId: 'p2', category: 'TODO' },
};

function inMemory(projectCodes: Record<string, string>) {
  const rows = new Map<string, TaskRecord>();
  const takenKeys = new Set<string>();
  let seq = 0;
  const withCategory = (t: TaskRecord): TaskRecord => ({ ...t, columnCategory: COLUMNS[t.columnId]?.category ?? null });
  const tasks: TaskRepository = {
    async create(data: CreateTaskData) {
      if (takenKeys.has(data.key)) throw new TaskKeyConflictError(data.key);
      takenKeys.add(data.key);
      const now = new Date();
      const rec: TaskRecord = {
        id: `t${seq++}`,
        key: data.key,
        title: data.title,
        description: data.description ?? null,
        projectId: data.projectId,
        columnId: data.columnId,
        position: 0,
        priority: data.priority ?? 'NORMAL',
        startDate: data.startDate ?? null,
        dueDate: data.dueDate ?? null,
        estimatedHours: data.estimatedHours ?? null,
        actualHours: null,
        progress: data.progress ?? 0,
        createdById: data.createdById,
        completedAt: data.completedAt ?? null,
        boardDate: data.boardDate ?? null,
        recurrenceRule: data.recurrenceRule ?? null,
        recurrenceParentId: data.recurrenceParentId ?? null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(rec.id, rec);
      return withCategory(rec);
    },
    async findById(id) {
      const t = rows.get(id);
      return t ? withCategory(t) : null;
    },
    async list(filter) {
      return [...rows.values()].filter((t) => (filter.projectId ? t.projectId === filter.projectId : true) && (filter.columnId ? t.columnId === filter.columnId : true)).map(withCategory);
    },
    async update(id, patch) {
      const cur = rows.get(id)!;
      const updated = { ...cur, ...patch, version: cur.version + 1, updatedAt: new Date() };
      rows.set(id, updated);
      return withCategory(updated);
    },
    async softDelete(id) {
      rows.delete(id);
    },
    async updateSeries(seriesId, patch, opts = {}) {
      for (const [mid, row] of rows) {
        if (row.id !== seriesId && row.recurrenceParentId !== seriesId) continue;
        if (opts.excludeId === row.id) continue;
        if (opts.openOnly && (row.completedAt || COLUMNS[row.columnId]?.category === 'DONE')) continue;
        rows.set(mid, { ...row, ...patch, version: row.version + 1, updatedAt: new Date() });
      }
    },
    async softDeleteSeries(seriesId) {
      for (const [mid, row] of [...rows]) {
        if (row.id === seriesId || row.recurrenceParentId === seriesId) rows.delete(mid);
      }
    },
    async countByProject(projectId) {
      return [...rows.values()].filter((t) => t.projectId === projectId).length;
    },
    async findColumn(columnId) {
      return COLUMNS[columnId] ?? null;
    },
    async reorderInColumn(columnId, orderedIds) {
      orderedIds.forEach((id, index) => {
        const row = rows.get(id);
        if (row && row.columnId === columnId) rows.set(id, { ...row, position: index });
      });
    },
  };
  const projects: ProjectLookup = {
    async getCodeById(projectId) {
      return projectCodes[projectId] ?? null;
    },
  };
  return { tasks, projects, takenKeys, rows };
}

let mem: ReturnType<typeof inMemory>;
let svc: ReturnType<typeof createTaskService>;
beforeEach(() => {
  mem = inMemory({ p1: 'MICO', p2: 'RIG' });
  svc = createTaskService({ tasks: mem.tasks, projects: mem.projects, timeZone: 'Asia/Muscat' });
});

const base = { title: 'Prepare report', projectId: 'p1', columnId: 'c1', createdById: 'admin' };

describe('TaskService', () => {
  it('reorders a column by re-sequencing task positions', async () => {
    const a = await svc.createTask(base);
    const b = await svc.createTask(base);
    const c = await svc.createTask(base);
    await svc.reorderColumn('c1', [c.id, a.id, b.id]); // new order: c, a, b
    expect((await svc.getTask(c.id)).position).toBe(0);
    expect((await svc.getTask(a.id)).position).toBe(1);
    expect((await svc.getTask(b.id)).position).toBe(2);
  });

  it('reorder only touches tasks of the given column', async () => {
    const a = await svc.createTask(base);
    const other = await svc.createTask({ ...base, columnId: 'c2' });
    await svc.updateTask(other.id, { position: 7 });
    await svc.reorderColumn('c1', [other.id, a.id]);
    expect((await svc.getTask(other.id)).position).toBe(7); // not in c1 → untouched
    expect((await svc.getTask(a.id)).position).toBe(1);
  });

  it('deletes the whole recurring series with scope "series", leaving unrelated tasks', async () => {
    const origin = await svc.createTask({ ...base, recurrenceRule: { freq: 'DAILY', interval: 1 } });
    const inst2 = await svc.createTask({ ...base, recurrenceParentId: origin.id });
    const inst3 = await svc.createTask({ ...base, recurrenceParentId: origin.id });
    const other = await svc.createTask(base);
    await svc.deleteTask(inst2.id, 'series');
    await expect(svc.getTask(origin.id)).rejects.toThrow();
    await expect(svc.getTask(inst2.id)).rejects.toThrow();
    await expect(svc.getTask(inst3.id)).rejects.toThrow();
    expect((await svc.getTask(other.id)).id).toBe(other.id);
  });

  it('deletes only this occurrence with the default scope', async () => {
    const origin = await svc.createTask({ ...base, recurrenceRule: { freq: 'DAILY', interval: 1 } });
    const inst2 = await svc.createTask({ ...base, recurrenceParentId: origin.id });
    await svc.deleteTask(inst2.id);
    await expect(svc.getTask(inst2.id)).rejects.toThrow();
    expect((await svc.getTask(origin.id)).id).toBe(origin.id);
  });

  it('applies an edit to the whole series with scope "series", leaving unrelated tasks', async () => {
    const origin = await svc.createTask({ ...base, recurrenceRule: { freq: 'DAILY', interval: 1 } });
    const inst2 = await svc.createTask({ ...base, recurrenceParentId: origin.id });
    const other = await svc.createTask(base);
    await svc.updateTask(inst2.id, { priority: 'URGENT' }, undefined, 'series');
    expect((await svc.getTask(origin.id)).priority).toBe('URGENT');
    expect((await svc.getTask(inst2.id)).priority).toBe('URGENT');
    expect((await svc.getTask(other.id)).priority).toBe('NORMAL');
  });

  it('a series edit copies only shared fields to other occurrences and never touches completed ones', async () => {
    const origin = await svc.createTask({ ...base, dueDate: new Date('2026-09-07T00:00:00Z'), recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    await svc.moveTask(origin.id, 'done'); // completed occurrence (history)
    const current = await svc.createTask({ ...base, dueDate: new Date('2026-09-14T00:00:00Z'), recurrenceParentId: origin.id });
    const future = await svc.createTask({ ...base, dueDate: new Date('2026-09-21T00:00:00Z'), recurrenceParentId: origin.id });

    await svc.updateTask(current.id, { title: 'Fixed typo', dueDate: new Date('2026-09-15T00:00:00Z') }, undefined, 'series');

    const [o, c, f] = await Promise.all([svc.getTask(origin.id), svc.getTask(current.id), svc.getTask(future.id)]);
    expect(c.title).toBe('Fixed typo');
    expect(c.dueDate?.toISOString()).toBe('2026-09-15T00:00:00.000Z'); // the edited occurrence gets everything
    expect(f.title).toBe('Fixed typo');
    expect(f.dueDate?.toISOString()).toBe('2026-09-21T00:00:00.000Z'); // …others keep their own dates
    expect(o.title).toBe('Prepare report'); // completed history is untouched
  });

  it('applies an edit to only this occurrence with the default scope', async () => {
    const origin = await svc.createTask({ ...base, recurrenceRule: { freq: 'DAILY', interval: 1 } });
    const inst2 = await svc.createTask({ ...base, recurrenceParentId: origin.id });
    await svc.updateTask(inst2.id, { priority: 'URGENT' });
    expect((await svc.getTask(inst2.id)).priority).toBe('URGENT');
    expect((await svc.getTask(origin.id)).priority).toBe('NORMAL');
  });

  it('generates a sequential key from the project code', async () => {
    const t1 = await svc.createTask(base);
    const t2 = await svc.createTask(base);
    expect(t1.key).toBe('MICO-1');
    expect(t2.key).toBe('MICO-2');
  });

  it('moves on to the next key number when a concurrent create took it', async () => {
    mem.takenKeys.add('MICO-1'); // e.g. a simultaneous create won the race for MICO-1
    const t = await svc.createTask(base);
    expect(t.key).toBe('MICO-2');
  });

  it('gives up with a 409 when every attempted key is taken', async () => {
    for (let i = 1; i <= 5; i++) mem.takenKeys.add(`MICO-${i}`);
    await expect(svc.createTask(base)).rejects.toMatchObject({ code: 'TASK_KEY_CONFLICT' });
    await expect(svc.createTask(base)).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFound when the project does not exist', async () => {
    await expect(svc.createTask({ ...base, projectId: 'ghost' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFound when getting an unknown task', async () => {
    await expect(svc.getTask('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates task fields', async () => {
    const t = await svc.createTask(base);
    const updated = await svc.updateTask(t.id, { title: 'Prepare monthly report', progress: 50 });
    expect(updated.title).toBe('Prepare monthly report');
    expect(updated.progress).toBe(50);
  });

  it('moves a task to another column', async () => {
    const t = await svc.createTask(base);
    const moved = await svc.moveTask(t.id, 'c2');
    expect(moved.columnId).toBe('c2');
  });

  it('marks a task complete when moved into a DONE column and re-opens it when moved out', async () => {
    const fixed = new Date('2026-09-08T10:00:00.000Z');
    const svc2 = createTaskService({ tasks: mem.tasks, projects: mem.projects, now: () => fixed });
    const t = await svc2.createTask(base);
    expect(t.completedAt).toBeNull();

    const done = await svc2.moveTask(t.id, 'done');
    expect(done.completedAt).toEqual(fixed);
    expect(done.progress).toBe(100);

    const reopened = await svc2.moveTask(t.id, 'c1');
    expect(reopened.completedAt).toBeNull();
  });

  it('keeps the completion time when a completed task is moved within (or between) Done columns', async () => {
    let clock = new Date('2026-09-08T10:00:00.000Z');
    const svc2 = createTaskService({ tasks: mem.tasks, projects: mem.projects, now: () => clock });
    const t = await svc2.createTask(base);
    await svc2.moveTask(t.id, 'done');
    clock = new Date('2026-09-20T10:00:00.000Z');
    const reordered = await svc2.moveTask(t.id, 'done', 3);
    expect(reordered.completedAt?.toISOString()).toBe('2026-09-08T10:00:00.000Z');
    const otherDone = await svc2.moveTask(t.id, 'done2');
    expect(otherDone.completedAt?.toISOString()).toBe('2026-09-08T10:00:00.000Z');
  });

  it('completes a task created straight into a DONE column', async () => {
    const fixed = new Date('2026-09-08T10:00:00.000Z');
    const svc2 = createTaskService({ tasks: mem.tasks, projects: mem.projects, now: () => fixed });
    const t = await svc2.createTask({ ...base, columnId: 'done' });
    expect(t.completedAt).toEqual(fixed);
    expect(t.progress).toBe(100);
  });

  it('rejects a column from another project on create, move and update', async () => {
    await expect(svc.createTask({ ...base, columnId: 'x1' })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.createTask({ ...base, columnId: 'ghost' })).rejects.toBeInstanceOf(ValidationError);
    const t = await svc.createTask(base);
    await expect(svc.moveTask(t.id, 'x1')).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.updateTask(t.id, { columnId: 'x1' })).rejects.toBeInstanceOf(ValidationError);
    expect((await svc.getTask(t.id)).columnId).toBe('c1');
  });

  it('treats a column change through update as a move (completion + onMoved)', async () => {
    const moves: { to: string; from: string; actor?: string }[] = [];
    const fixed = new Date('2026-09-08T10:00:00.000Z');
    const svc2 = createTaskService({
      tasks: mem.tasks,
      projects: mem.projects,
      now: () => fixed,
      onMoved: (task, from, actor) => { moves.push({ to: task.columnId, from, actor }); },
    });
    const t = await svc2.createTask(base);
    const done = await svc2.updateTask(t.id, { columnId: 'done', title: 'Wrapped up' }, undefined, 'one', 'u1');
    expect(done.completedAt).toEqual(fixed);
    expect(done.title).toBe('Wrapped up');
    expect(moves).toEqual([{ to: 'done', from: 'c1', actor: 'u1' }]);
    await svc2.updateTask(t.id, { title: 'No move' });
    expect(moves).toHaveLength(1); // no column change → no move hook
  });

  it('lists tasks filtered by project', async () => {
    await svc.createTask(base);
    await svc.createTask(base);
    expect(await svc.listTasks({ projectId: 'p1' })).toHaveLength(2);
    expect(await svc.listTasks({ projectId: 'other' })).toHaveLength(0);
  });

  it('soft-deletes a task', async () => {
    const t = await svc.createTask(base);
    await svc.deleteTask(t.id);
    await expect(svc.getTask(t.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('auto-sets the start date to the creation time when none is provided', async () => {
    const fixed = new Date('2026-09-08T10:00:00.000Z');
    const withClock = createTaskService({ tasks: mem.tasks, projects: mem.projects, now: () => fixed });
    const t = await withClock.createTask(base);
    expect(t.startDate).toEqual(fixed);
  });

  it('keeps an explicitly provided start date instead of auto-setting it', async () => {
    const explicit = new Date('2026-01-01T00:00:00.000Z');
    const t = await svc.createTask({ ...base, startDate: explicit });
    expect(t.startDate).toEqual(explicit);
  });

  it('rejects a start date after the due date (create and update)', async () => {
    await expect(
      svc.createTask({ ...base, startDate: new Date('2026-09-10T00:00:00Z'), dueDate: new Date('2026-09-09T00:00:00Z') }),
    ).rejects.toBeInstanceOf(ValidationError);
    const t = await svc.createTask({ ...base, startDate: new Date('2026-09-01T00:00:00Z'), dueDate: new Date('2026-09-09T00:00:00Z') });
    await expect(svc.updateTask(t.id, { dueDate: new Date('2026-08-30T00:00:00Z') })).rejects.toBeInstanceOf(ValidationError);
    // Same day is fine.
    await expect(svc.updateTask(t.id, { dueDate: new Date('2026-09-01T00:00:00Z') })).resolves.toBeTruthy();
  });

  it('defaults the start date to the due day when the task is created already past due', async () => {
    const fixed = new Date('2026-09-08T10:00:00.000Z');
    const withClock = createTaskService({ tasks: mem.tasks, projects: mem.projects, now: () => fixed, timeZone: 'Asia/Muscat' });
    const t = await withClock.createTask({ ...base, dueDate: new Date('2026-09-05T00:00:00Z') });
    expect(t.startDate?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('still allows editing other fields of a legacy task whose dates are out of order', async () => {
    const t = await svc.createTask(base);
    mem.rows.set(t.id, { ...mem.rows.get(t.id)!, startDate: new Date('2026-09-10T00:00:00Z'), dueDate: new Date('2026-09-01T00:00:00Z') });
    // The drawer re-sends the unchanged due date with every save.
    await expect(svc.updateTask(t.id, { title: 'ok', dueDate: new Date('2026-09-01T00:00:00Z') })).resolves.toMatchObject({ title: 'ok' });
  });

  it('stores a due date as its calendar day (UTC midnight), reading timestamps in company time', async () => {
    // 22:00 UTC on the 29th is 02:00 on the 30th in Muscat → due the 30th.
    const t = await svc.createTask({ ...base, dueDate: new Date('2026-09-29T22:00:00Z') });
    expect(t.dueDate?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    const plain = await svc.createTask({ ...base, dueDate: new Date('2026-09-30T00:00:00Z') });
    expect(plain.dueDate?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('stores a valid recurrence rule on create', async () => {
    const t = await svc.createTask({ ...base, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } });
    expect(t.recurrenceRule).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [1] });
  });

  it('pins a monthly series to its first due day (anchor) so month-end dates don’t drift', async () => {
    const t = await svc.createTask({ ...base, dueDate: new Date('2026-01-31T00:00:00Z'), recurrenceRule: { freq: 'MONTHLY', interval: 1 } });
    expect(t.recurrenceRule).toEqual({ freq: 'MONTHLY', interval: 1, anchorDay: 31 });
  });

  it('rejects an invalid recurrence rule on create', async () => {
    await expect(svc.createTask({ ...base, recurrenceRule: { freq: 'DAILY', interval: 0 } })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an invalid recurrence rule on update', async () => {
    const t = await svc.createTask(base);
    await expect(svc.updateTask(t.id, { recurrenceRule: { freq: 'MONTHLY', interval: 1, dayOfMonth: 40 } })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a stale update via optimistic concurrency (version mismatch)', async () => {
    const t = await svc.createTask(base); // version 0
    await expect(svc.updateTask(t.id, { title: 'x' }, 5)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('allows an update when the expected version matches (or is omitted)', async () => {
    const t = await svc.createTask(base); // version 0
    const ok = await svc.updateTask(t.id, { title: 'Fresh' }, 0);
    expect(ok.title).toBe('Fresh');
    const ok2 = await svc.updateTask(t.id, { title: 'Fresher' }); // no expectedVersion → allowed
    expect(ok2.title).toBe('Fresher');
  });

  it('fires the onMoved hook with the moved task', async () => {
    const moves: string[] = [];
    const withHook = createTaskService({ tasks: mem.tasks, projects: mem.projects, onMoved: (task) => { moves.push(task.columnId); } });
    const t = await withHook.createTask(base);
    await withHook.moveTask(t.id, 'done');
    expect(moves).toEqual(['done']);
  });

  it('exposes the company time zone it works in', () => {
    expect(svc.timeZone).toBe('Asia/Muscat');
  });
});
