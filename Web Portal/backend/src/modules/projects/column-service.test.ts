import { describe, it, expect, beforeEach } from 'vitest';
import { createColumnService } from './column-service';
import type { ColumnRecord, ColumnRepository, CreateColumnData } from './column-repository';

function inMemory(): ColumnRepository {
  const rows: ColumnRecord[] = [];
  let seq = 0;
  return {
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
});
