import { describe, it, expect, beforeEach } from 'vitest';
import { createTaskService } from './task-service';
import type { CreateTaskData, TaskRecord, TaskRepository, ProjectLookup } from './task-repository';
import { NotFoundError, ValidationError } from '../../lib/http-errors';

function inMemory(projectCodes: Record<string, string>) {
  const rows = new Map<string, TaskRecord>();
  let seq = 0;
  const tasks: TaskRepository = {
    async create(data: CreateTaskData) {
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
        completedAt: null,
        boardDate: data.boardDate ?? null,
        recurrenceRule: data.recurrenceRule ?? null,
        recurrenceParentId: data.recurrenceParentId ?? null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list(filter) {
      return [...rows.values()].filter((t) => (filter.projectId ? t.projectId === filter.projectId : true) && (filter.columnId ? t.columnId === filter.columnId : true));
    },
    async update(id, patch) {
      const updated = { ...rows.get(id)!, ...patch, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async softDelete(id) {
      rows.delete(id);
    },
    async updateSeries(seriesId, patch) {
      for (const [mid, row] of rows) {
        if (row.id === seriesId || row.recurrenceParentId === seriesId) {
          rows.set(mid, { ...row, ...patch, version: row.version + 1, updatedAt: new Date() });
        }
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
  };
  const projects: ProjectLookup = {
    async getCodeById(projectId) {
      return projectCodes[projectId] ?? null;
    },
  };
  return { tasks, projects };
}

let svc: ReturnType<typeof createTaskService>;
beforeEach(() => {
  const mem = inMemory({ p1: 'MICO' });
  svc = createTaskService(mem);
});

const base = { title: 'Prepare report', projectId: 'p1', columnId: 'c1', createdById: 'admin' };

describe('TaskService', () => {
  it('reorders a column by re-sequencing task positions', async () => {
    const a = await svc.createTask(base);
    const b = await svc.createTask(base);
    const c = await svc.createTask(base);
    await svc.reorderColumn([c.id, a.id, b.id]); // new order: c, a, b
    expect((await svc.getTask(c.id)).position).toBe(0);
    expect((await svc.getTask(a.id)).position).toBe(1);
    expect((await svc.getTask(b.id)).position).toBe(2);
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
    const categories: Record<string, string> = { done: 'DONE', todo: 'TODO' };
    const mem = inMemory({ p1: 'MICO' });
    const svc2 = createTaskService({
      ...mem,
      now: () => fixed,
      columns: { async categoryOf(id) { return categories[id] ?? null; } },
    });
    const t = await svc2.createTask({ ...base, columnId: 'todo' });
    expect(t.completedAt).toBeNull();

    const done = await svc2.moveTask(t.id, 'done');
    expect(done.completedAt).toEqual(fixed);
    expect(done.progress).toBe(100);

    const reopened = await svc2.moveTask(t.id, 'todo');
    expect(reopened.completedAt).toBeNull();
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
    const mem = inMemory({ p1: 'MICO' });
    const withClock = createTaskService({ ...mem, now: () => fixed });
    const t = await withClock.createTask(base);
    expect(t.startDate).toEqual(fixed);
  });

  it('keeps an explicitly provided start date instead of auto-setting it', async () => {
    const explicit = new Date('2026-01-01T00:00:00.000Z');
    const t = await svc.createTask({ ...base, startDate: explicit });
    expect(t.startDate).toEqual(explicit);
  });

  it('stores a valid recurrence rule on create', async () => {
    const t = await svc.createTask({ ...base, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } });
    expect(t.recurrenceRule).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [1] });
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
    const mem = inMemory({ p1: 'MICO' });
    const withHook = createTaskService({ ...mem, onMoved: (task) => { moves.push(task.columnId); } });
    const t = await withHook.createTask(base);
    await withHook.moveTask(t.id, 'done-col');
    expect(moves).toEqual(['done-col']);
  });
});
