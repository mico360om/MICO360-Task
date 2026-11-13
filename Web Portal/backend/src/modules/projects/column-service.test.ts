import { describe, it, expect, beforeEach } from 'vitest';
import { createColumnService } from './column-service';
import type { ColumnRecord, ColumnRepository, CreateColumnData } from './column-repository';
import { ConflictError } from '../../lib/http-errors';

/** Live task counts per column id, so tests can fill a column. */
const liveTasks = new Map<string, number>();
/** Review fix #13: what else a column holds (archived, in the Recycle Bin, waiting), per column id. */
const otherTasks = new Map<string, { archived?: number; binned?: number; waiting?: number }>();

function inMemory(): ColumnRepository {
  const rows: ColumnRecord[] = [];
  let seq = 0;
  return {
    async countLiveTasks(id) {
      return liveTasks.get(id) ?? 0;
    },
    async listForProject(projectId) {
      return rows.filter((c) => c.projectId === projectId).sort((a, b) => a.position - b.position);
    },
    async create(data: CreateColumnData) {
      const c: ColumnRecord = {
        id: `c${seq++}`,
        projectId: data.projectId,
        name: data.name,
        category: data.category ?? 'TODO',
        position: data.position,
        color: data.color ?? '#948985',
        enabled: true,
      };
      rows.push(c);
      return c;
    },
    async update(id, patch) {
      const c = rows.find((r) => r.id === id)!;
      Object.assign(c, patch);
      return c;
    },
    async changeStatus(id, patch, check) {
      const c = rows.find((r) => r.id === id)!;
      const o = otherTasks.get(id) ?? {};
      check({ category: c.category, live: liveTasks.get(id) ?? 0, archived: o.archived ?? 0, binned: o.binned ?? 0, waiting: o.waiting ?? 0 });
      Object.assign(c, patch);
      return c;
    },
    async remove(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return null;
      const [removed] = rows.splice(i, 1);
      return { projectId: removed!.projectId };
    },
  };
}

let svc: ReturnType<typeof createColumnService>;
beforeEach(() => {
  liveTasks.clear();
  otherTasks.clear();
  svc = createColumnService({ columns: inMemory() });
});

describe('ColumnService', () => {
  it('adds columns with incrementing positions', async () => {
    const a = await svc.addColumn('p1', { name: 'To Do' });
    const b = await svc.addColumn('p1', { name: 'Done', category: 'DONE' });
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(b.category).toBe('DONE');
  });

  it('assigns the next position from max(position)+1, not the count (avoids collisions after reorders)', async () => {
    const a = await svc.addColumn('p1', { name: 'A' }); // pos 0
    const b = await svc.addColumn('p1', { name: 'B' }); // pos 1
    await svc.updateColumn(b.id, { position: 5 }); // now positions are [0, 5], count is 2
    const c = await svc.addColumn('p1', { name: 'C' });
    expect(c.position).toBe(6); // max(0,5)+1 — not 2, which would collide is possible
    expect(c.position).not.toBe(a.position);
  });

  it('lists a project’s columns in order', async () => {
    await svc.addColumn('p1', { name: 'A' });
    await svc.addColumn('p1', { name: 'B' });
    const cols = await svc.listColumns('p1');
    expect(cols.map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('1.23.8: a column added without a colour, or moved to another status, takes that status’s colour (one scheme)', async () => {
    const c = await svc.addColumn('p1', { name: 'Doing', category: 'IN_PROGRESS' });
    expect(c.color).toBe('#2F6DB5');
    expect((await svc.updateColumn(c.id, { category: 'REVIEW' })).color).toBe('#7C56B4');
    // A colour sent with the change (the Android app's picker) is kept.
    expect((await svc.updateColumn(c.id, { category: 'DONE', color: '#123456' })).color).toBe('#123456');
    // Renaming leaves the colour alone.
    expect((await svc.updateColumn(c.id, { name: 'Finished' })).color).toBe('#123456');
  });

  it('renames a column', async () => {
    const c = await svc.addColumn('p1', { name: 'Todo' });
    const updated = await svc.updateColumn(c.id, { name: 'To Do' });
    expect(updated.name).toBe('To Do');
  });

  it('removes a column and returns its project id (for broadcasts)', async () => {
    const c = await svc.addColumn('p1', { name: 'X' });
    const removed = await svc.removeColumn(c.id);
    expect(removed).toEqual({ projectId: 'p1' });
    expect(await svc.listColumns('p1')).toHaveLength(0);
  });

  it('refuses (409) to delete a column that still has live tasks', async () => {
    const c = await svc.addColumn('p1', { name: 'Busy' });
    liveTasks.set(c.id, 2);
    await expect(svc.removeColumn(c.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.removeColumn(c.id)).rejects.toMatchObject({ code: 'COLUMN_NOT_EMPTY' });
    expect(await svc.listColumns('p1')).toHaveLength(1);
  });

  it('refuses (409) to make a column a Done column while tasks in it wait for approval (they would count as done)', async () => {
    const waiting = new Map<string, number>();
    const guarded = createColumnService({ columns: inMemory(), waitingTasksIn: async (id) => waiting.get(id) ?? 0 });
    const c = await guarded.addColumn('p1', { name: 'Review', category: 'REVIEW' });
    waiting.set(c.id, 2);
    await expect(guarded.updateColumn(c.id, { category: 'DONE' })).rejects.toMatchObject({ code: 'TASKS_WAITING', status: 409 });
    expect((await guarded.updateColumn(c.id, { name: 'Checked' })).name).toBe('Checked');
    waiting.set(c.id, 0);
    expect((await guarded.updateColumn(c.id, { category: 'DONE' })).category).toBe('DONE');
  });

  it('review fix #13: refuses (409) a change into or out of Done while the column holds tasks — on the board, archived or in the Recycle Bin', async () => {
    const todo = await svc.addColumn('p1', { name: 'To do' });
    const done = await svc.addColumn('p1', { name: 'Done', category: 'DONE' });
    liveTasks.set(todo.id, 1);
    await expect(svc.updateColumn(todo.id, { category: 'DONE' })).rejects.toMatchObject({ status: 409, code: 'COLUMN_HAS_TASKS', message: 'Move the tasks out of this column first, then change its status.' });
    liveTasks.set(done.id, 3);
    await expect(svc.updateColumn(done.id, { category: 'IN_PROGRESS' })).rejects.toMatchObject({ code: 'COLUMN_HAS_TASKS' });
    liveTasks.clear();
    otherTasks.set(todo.id, { archived: 2, binned: 1 });
    await expect(svc.updateColumn(todo.id, { category: 'DONE' })).rejects.toMatchObject({
      message: 'Move the tasks out of this column first, then change its status. That includes 2 archived tasks and 1 task in the Recycle Bin.',
    });
    const rows = await svc.listColumns('p1');
    expect(rows.map((c) => c.category)).toEqual(['TODO', 'DONE']);
  });

  it('review fix #13: other changes keep working — between open kinds with tasks, into or out of Done when empty, name and visibility of a full column', async () => {
    const todo = await svc.addColumn('p1', { name: 'To do' });
    const done = await svc.addColumn('p1', { name: 'Done', category: 'DONE' });
    liveTasks.set(todo.id, 4);
    liveTasks.set(done.id, 4);
    expect((await svc.updateColumn(todo.id, { category: 'BLOCKED' })).category).toBe('BLOCKED');
    expect((await svc.updateColumn(done.id, { name: 'Finished', enabled: false })).name).toBe('Finished');
    expect((await svc.updateColumn(done.id, { category: 'DONE' })).category).toBe('DONE');
    liveTasks.clear();
    expect((await svc.updateColumn(todo.id, { category: 'DONE' })).category).toBe('DONE');
    expect((await svc.updateColumn(done.id, { category: 'TODO' })).category).toBe('TODO');
  });

  it('review fix #13: tasks waiting for approval keep their own refusal (TASKS_WAITING) through the same step', async () => {
    const review = await svc.addColumn('p1', { name: 'Review', category: 'REVIEW' });
    otherTasks.set(review.id, { waiting: 1 });
    liveTasks.set(review.id, 1);
    await expect(svc.updateColumn(review.id, { category: 'DONE' })).rejects.toMatchObject({ code: 'TASKS_WAITING' });
  });
});
