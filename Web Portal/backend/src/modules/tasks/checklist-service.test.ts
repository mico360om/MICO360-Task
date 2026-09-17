import { describe, it, expect } from 'vitest';
import { progressFromItems, createChecklistService } from './checklist-service';
import type { ChecklistItemRecord, ChecklistRepository } from './checklist-repository';
import type { TaskLookup } from './assignee-repository';
import { NotFoundError, ValidationError } from '../../lib/http-errors';

describe('progressFromItems', () => {
  it('is 0 for no items', () => expect(progressFromItems([])).toBe(0));
  it('is 50 when half are done', () => expect(progressFromItems([{ done: true }, { done: false }])).toBe(50));
  it('is 100 when all are done', () => expect(progressFromItems([{ done: true }, { done: true }])).toBe(100));
  it('rounds to the nearest percent', () => expect(progressFromItems([{ done: true }, { done: false }, { done: false }])).toBe(33));
});

function inMemory(tasks: string[]) {
  const rows: ChecklistItemRecord[] = [];
  let seq = 0;
  const repo: ChecklistRepository = {
    async add(taskId, text, position) {
      const item: ChecklistItemRecord = { id: `i${seq++}`, taskId, text, done: false, position };
      rows.push(item);
      return item;
    },
    async toggle(itemId, done) {
      const item = rows.find((r) => r.id === itemId)!;
      item.done = done;
      return item;
    },
    async editText(itemId, text) {
      const item = rows.find((r) => r.id === itemId)!;
      item.text = text;
      return item;
    },
    async list(taskId) {
      return rows.filter((r) => r.taskId === taskId).sort((a, b) => a.position - b.position);
    },
    async reorder(taskId, orderedIds) {
      orderedIds.forEach((id, index) => {
        const item = rows.find((r) => r.id === id && r.taskId === taskId);
        if (item) item.position = index;
      });
      return rows.filter((r) => r.taskId === taskId).sort((a, b) => a.position - b.position);
    },
    async remove(itemId) {
      const i = rows.findIndex((r) => r.id === itemId);
      if (i < 0) return null;
      const [removed] = rows.splice(i, 1);
      return { taskId: removed!.taskId };
    },
  };
  const taskLookup: TaskLookup = { async exists(id) { return tasks.includes(id); } };
  return { repo, taskLookup };
}

describe('ChecklistService', () => {
  it('adds items with incrementing positions', async () => {
    const svc = createChecklistService(inMemory(['t1']));
    const a = await svc.addItem('t1', 'Verify quotation');
    const b = await svc.addItem('t1', 'Confirm supplier');
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
  });

  it('computes task progress from checklist state', async () => {
    const svc = createChecklistService(inMemory(['t1']));
    const a = await svc.addItem('t1', 'x');
    await svc.addItem('t1', 'y');
    expect(await svc.progress('t1')).toBe(0);
    await svc.toggleItem(a.id, true);
    expect(await svc.progress('t1')).toBe(50);
  });

  it('throws NotFound when adding to an unknown task', async () => {
    const svc = createChecklistService(inMemory(['t1']));
    await expect(svc.addItem('ghost', 'x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('edits an item’s text (trimmed) and rejects blank text', async () => {
    const svc = createChecklistService(inMemory(['t1']));
    const a = await svc.addItem('t1', 'old');
    const edited = await svc.editItem(a.id, '  new text  ');
    expect(edited.text).toBe('new text');
    await expect(svc.editItem(a.id, '   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('reorders items and reports an X-of-Y summary', async () => {
    const svc = createChecklistService(inMemory(['t1']));
    const a = await svc.addItem('t1', 'A');
    const b = await svc.addItem('t1', 'B');
    const c = await svc.addItem('t1', 'C');
    await svc.toggleItem(a.id, true);
    expect(await svc.summary('t1')).toEqual({ done: 1, total: 3, percent: 33 });

    const reordered = await svc.reorderItems('t1', [c.id, b.id, a.id]);
    expect(reordered.map((i) => i.text)).toEqual(['C', 'B', 'A']);
  });

  it('removes an item and returns its task id (for broadcasts)', async () => {
    const svc = createChecklistService(inMemory(['t1']));
    const a = await svc.addItem('t1', 'x');
    expect(await svc.removeItem(a.id)).toEqual({ taskId: 't1' });
  });
});
