import { describe, it, expect, beforeEach } from 'vitest';
import { progressFromItems, createChecklistService, rowsFromTree, copyRowsForRepeat, RESTORE_DAYS } from './checklist-service';
import { createMemoryChecklistStore } from './checklist-store';
import { arrange } from './checklist-tree';
import { NotFoundError, ValidationError } from '../../lib/http-errors';

describe('progressFromItems', () => {
  it('is 0 for no items', () => expect(progressFromItems([])).toBe(0));
  it('is 50 when half are done', () => expect(progressFromItems([{ done: true }, { done: false }])).toBe(50));
  it('rounds to the nearest percent', () => expect(progressFromItems([{ done: true }, { done: false }, { done: false }])).toBe(33));
});

let clock = new Date('2026-11-06T08:00:00Z');
function setup(extra: { eligible?: string[]; onProgress?: (taskId: string, p: number) => Promise<void> | void } = {}) {
  const store = createMemoryChecklistStore({ liveTasks: () => ['t1', 't2'] });
  const progress: [string, number][] = [];
  const changed: string[] = [];
  const service = createChecklistService({
    store,
    now: () => clock,
    taskLookup: { async exists(id) { return id === 't1' || id === 't2'; } },
    eligibleAssignees: async (_t, ids) => ids.filter((id) => (extra.eligible ?? ['u1', 'u2']).includes(id)),
    namesOf: async (ids) => new Map(ids.map((id) => [id, id === 'u2' ? 'Mariam Said' : 'Khurram'])),
    onProgress: extra.onProgress ?? ((taskId, p) => void progress.push([taskId, p])),
    onChanged: (taskId) => void changed.push(taskId),
  });
  return { store, service, progress, changed };
}
type S = ReturnType<typeof setup>;
const texts = async (s: S, taskId = 't1') => (await s.service.view(taskId)).items.map((i) => `${'  '.repeat(i.depth)}${i.text}${i.done ? ' ✓' : ''}`);

/** Panel › (Label circuits, Test RCD); Lights. */
async function sample(s: S) {
  const [panel, lights] = (await s.service.addItems('t1', 'u1', { texts: ['Panel', 'Lights'] })).items;
  const [label, rcd] = (await s.service.addItems('t1', 'u1', { texts: ['Label circuits', 'Test RCD'], parentId: panel!.id })).items;
  return { panel: panel!, lights: lights!, label: label!, rcd: rcd! };
}

beforeEach(() => {
  clock = new Date('2026-11-06T08:00:00Z');
});

describe('adding', () => {
  it('a task with no checklist gets one titled "Checklist" for its first item (older apps)', async () => {
    const s = setup();
    const item = await s.service.addItem('t1', '  Buy cable  ');
    const v = await s.service.view('t1');
    expect(v.lists.map((l) => l.title)).toEqual(['Checklist']);
    expect(item).toMatchObject({ text: 'Buy cable', done: false, listId: v.lists[0]!.id, parentId: null, depth: 0, position: 0 });
    expect((await s.service.addItem('t1', 'Second')).position).toBe(1);
  });

  it('adds sub-items under a parent, after a sibling, in several checklists', async () => {
    const s = setup();
    const { panel, label } = await sample(s);
    await s.service.addItems('t1', 'u1', { texts: ['Breakers'], afterId: label.id });
    const fit = await s.service.addList('t1', 'u1', 'Fit-out');
    await s.service.addItems('t1', 'u1', { texts: ['Paint'], listId: fit.id });
    expect(await texts(s)).toEqual(['Panel', '  Label circuits', '  Breakers', '  Test RCD', 'Lights', 'Paint']);
    const v = await s.service.view('t1');
    expect(v.items.find((i) => i.id === panel.id)).toMatchObject({ childCount: 3, subDone: 0, subTotal: 3 });
    expect(v.lists.map((l) => [l.title, l.done, l.total])).toEqual([['Checklist', 0, 4], ['Fit-out', 0, 1]]);
  });

  it('refuses blank text, unknown places, unknown tasks and people outside the project', async () => {
    const s = setup();
    await expect(s.service.addItem('t1', '   ')).rejects.toBeInstanceOf(ValidationError);
    await expect(s.service.addItems('t1', 'u1', { texts: ['x'], parentId: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.service.addItems('t1', 'u1', { texts: ['x'], assigneeId: 'stranger' })).rejects.toThrow(/Only active members/);
    await expect(s.service.addItem('t9', 'x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFound (not a 500) for an unknown item on get/toggle/edit/remove/move/duplicate', async () => {
    const s = setup();
    await expect(s.service.getItem('ghost')).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.service.toggleItem('ghost', true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.service.editItem('ghost', 'x')).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.service.removeItem('ghost')).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.service.moveItem('ghost', null, { action: 'up' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.service.duplicateList('ghost')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps to the limits: 20 levels and 500 items per task', async () => {
    const s = setup();
    let parentId: string | null = null;
    for (let level = 0; level < 20; level++) {
      const res: { items: { id: string }[] } = await s.service.addItems('t1', 'u1', { texts: [`L${level}`], parentId });
      parentId = res.items[0]!.id;
    }
    await expect(s.service.addItems('t1', 'u1', { texts: ['too deep'], parentId })).rejects.toThrow(/20 levels/);
    for (let n = 0; n < 5; n++) await s.service.addItems('t2', 'u1', { texts: Array.from({ length: 100 }, (_, i) => `j${n}-${i}`) });
    await expect(s.service.addItem('t2', 'one more')).rejects.toThrow(/500 checklist items/);
  });
});

describe('the parent rule (owner: a parent follows its sub-items)', () => {
  it('a parent ticks itself when all its sub-items are done and unticks when one is reopened', async () => {
    const s = setup();
    const { panel, label, rcd } = await sample(s);
    await s.service.toggleItem(label.id, true, 'u1');
    expect((await s.service.getItem(panel.id)).done).toBe(false);
    const last = await s.service.updateItem(rcd.id, 'u1', { done: true });
    expect(last.item).toMatchObject({ done: true, completedById: 'u1' });
    expect(await s.service.getItem(panel.id)).toMatchObject({ done: true, subDone: 2, subTotal: 2 });
    await s.service.toggleItem(label.id, false, 'u2');
    expect((await s.service.getItem(panel.id)).done).toBe(false);
  });

  it('a parent can not be ticked by hand while sub-items are open, nor unticked while they are all done', async () => {
    const s = setup();
    const { panel, label, rcd } = await sample(s);
    await expect(s.service.toggleItem(panel.id, true)).rejects.toMatchObject({ code: 'CHECKLIST_PARENT', status: 400, message: '2 sub-items still open.' });
    await s.service.toggleItem(label.id, true);
    await expect(s.service.toggleItem(panel.id, true)).rejects.toMatchObject({ message: '1 sub-item still open.' });
    await s.service.toggleItem(rcd.id, true);
    await expect(s.service.toggleItem(panel.id, false)).rejects.toMatchObject({ code: 'CHECKLIST_PARENT', message: /reopen one of them/ });
    // Asking for what it already is changes nothing and is fine (an offline replay).
    expect((await s.service.toggleItem(panel.id, true)).done).toBe(true);
  });

  it('adding an open sub-item to a ticked parent unticks it; a completed parent never marks open children done', async () => {
    const s = setup();
    const { panel, label, rcd } = await sample(s);
    await s.service.toggleItem(label.id, true);
    await s.service.toggleItem(rcd.id, true);
    expect((await s.service.getItem(panel.id)).done).toBe(true);
    const [extra] = (await s.service.addItems('t1', 'u1', { texts: ['Photos'], parentId: panel.id })).items;
    expect((await s.service.getItem(panel.id)).done).toBe(false);
    expect((await s.service.getItem(extra!.id)).done).toBe(false);
  });

  it('counts use the leaves only: 8/12 is never double-counted', async () => {
    const s = setup();
    const { label } = await sample(s);
    await s.service.toggleItem(label.id, true);
    expect(await s.service.summary('t1')).toEqual({ done: 1, total: 3, percent: 33 });
    expect(s.progress.at(-1)).toEqual(['t1', 33]);
  });

  it('deleting the last open sub-item ticks the parent; deleting every sub-item leaves its tick as it was', async () => {
    const s = setup();
    const { panel, label, rcd } = await sample(s);
    await s.service.toggleItem(label.id, true);
    await s.service.removeItem(rcd.id, 'u1');
    expect((await s.service.getItem(panel.id)).done).toBe(true);
    await s.service.removeItem(label.id, 'u1');
    expect(await s.service.getItem(panel.id)).toMatchObject({ done: true, childCount: 0 });
  });

  it('progress is reported after every change, and a failing report never fails the change', async () => {
    const s = setup();
    const a = await s.service.addItem('t1', 'first');
    const b = await s.service.addItem('t1', 'second');
    await s.service.toggleItem(a.id, true);
    await s.service.toggleItem(b.id, true);
    await s.service.toggleItem(b.id, false);
    await s.service.removeItem(b.id);
    expect(s.progress).toEqual([['t1', 0], ['t1', 0], ['t1', 50], ['t1', 100], ['t1', 50], ['t1', 100]]);
    const broken = setup({ onProgress: async () => { throw new Error('task store down'); } });
    const c = await broken.service.addItem('t1', 'first');
    await expect(broken.service.toggleItem(c.id, true)).resolves.toMatchObject({ done: true });
  });

  it('the search index hears about changes to words only', async () => {
    const s = setup();
    const item = await s.service.addItem('t1', 'Photograph the plates');
    await s.service.editItem(item.id, 'Photograph the base plates');
    await s.service.toggleItem(item.id, true); // ticking changes no words
    await s.service.removeItem(item.id);
    expect(s.changed).toEqual(['t1', 't1', 't1']);
  });
});

describe('moving', () => {
  it('indents, outdents and moves up and down; the old parent and the new one follow', async () => {
    const s = setup();
    const { panel, lights, rcd } = await sample(s);
    await s.service.moveItem(lights.id, 'u1', { action: 'indent' });
    expect(await texts(s)).toEqual(['Panel', '  Label circuits', '  Test RCD', '  Lights']);
    const moved = await s.service.moveItem(rcd.id, 'u1', { action: 'up' });
    expect(moved.how).toBe('up');
    expect(await texts(s)).toEqual(['Panel', '  Test RCD', '  Label circuits', '  Lights']);
    await s.service.moveItem(rcd.id, 'u1', { action: 'outdent' });
    expect(await texts(s)).toEqual(['Panel', '  Label circuits', '  Lights', 'Test RCD']);
    await s.service.moveItem(rcd.id, 'u1', { action: 'up' });
    expect(await texts(s)).toEqual(['Test RCD', 'Panel', '  Label circuits', '  Lights']);
    await expect(s.service.moveItem(rcd.id, 'u1', { action: 'up' })).rejects.toBeInstanceOf(ValidationError);
    expect((await s.service.getItem(panel.id)).childCount).toBe(2);
  });

  it('refuses circular nesting: under itself or any of its sub-items', async () => {
    const s = setup();
    const { panel, label } = await sample(s);
    const [deep] = (await s.service.addItems('t1', 'u1', { texts: ['Deep'], parentId: label.id })).items;
    await expect(s.service.moveItem(panel.id, 'u1', { parentId: panel.id, afterId: null })).rejects.toMatchObject({ code: 'CHECKLIST_CIRCULAR', status: 400 });
    await expect(s.service.moveItem(panel.id, 'u1', { parentId: deep!.id, afterId: null })).rejects.toMatchObject({ code: 'CHECKLIST_CIRCULAR' });
    expect(await texts(s)).toEqual(['Panel', '  Label circuits', '    Deep', '  Test RCD', 'Lights']);
  });

  it('moves a whole sub-tree to another checklist, and refuses one that would go past 20 levels', async () => {
    const s = setup();
    const { panel } = await sample(s);
    const fit = await s.service.addList('t1', 'u1', 'Fit-out');
    await s.service.moveItem(panel.id, 'u1', { listId: fit.id, parentId: null, afterId: null });
    const v = await s.service.view('t1');
    expect(v.lists.map((l) => [l.title, l.total])).toEqual([['Checklist', 1], ['Fit-out', 2]]);
    let parentId: string | null = null;
    for (let level = 0; level < 19; level++) {
      const res: { items: { id: string }[] } = await s.service.addItems('t2', 'u1', { texts: [`L${level}`], parentId });
      parentId = res.items[0]!.id;
    }
    const [twoLevels] = (await s.service.addItems('t2', 'u1', { texts: ['A'] })).items;
    await s.service.addItems('t2', 'u1', { texts: ['B'], parentId: twoLevels!.id });
    await expect(s.service.moveItem(twoLevels!.id, 'u1', { parentId, afterId: null })).rejects.toThrow(/20 levels/);
  });

  it('the old reorder (older apps send every id) reorders within each level and never changes the tree', async () => {
    const s = setup();
    const { panel, lights, label, rcd } = await sample(s);
    await s.service.reorderItems('t1', [lights.id, rcd.id, label.id, panel.id]);
    expect(await texts(s)).toEqual(['Lights', 'Panel', '  Test RCD', '  Label circuits']);
  });
});

describe('people and dates', () => {
  it('assigns an item to someone on the team with a due date, and clears them', async () => {
    const s = setup();
    const { label } = await sample(s);
    const res = await s.service.updateItem(label.id, 'u1', { assigneeId: 'u2', dueDate: new Date('2026-11-10T00:00:00Z') });
    expect(res.before).toMatchObject({ assigneeId: null, dueDate: null });
    expect(res.item).toMatchObject({ assigneeId: 'u2', assignee: { id: 'u2', name: 'Mariam Said' }, dueDate: '2026-11-10' });
    await expect(s.service.updateItem(label.id, 'u1', { assigneeId: 'client9' })).rejects.toThrow(/Only active members/);
    expect((await s.service.updateItem(label.id, 'u1', { assigneeId: null, dueDate: null })).item).toMatchObject({ assigneeId: null, dueDate: null });
  });
});

describe('duplicating', () => {
  it('copies an item and its sub-items right after it, ticks cleared, people and dates kept', async () => {
    const s = setup();
    const { panel, label } = await sample(s);
    await s.service.updateItem(label.id, 'u1', { done: true, assigneeId: 'u2', dueDate: new Date('2026-11-10T00:00:00Z') });
    const dup = await s.service.duplicateItem(panel.id, 'u1');
    expect(dup.count).toBe(3);
    expect(await texts(s)).toEqual(['Panel', '  Label circuits ✓', '  Test RCD', 'Panel (copy)', '  Label circuits', '  Test RCD', 'Lights']);
    const copy = (await s.service.view('t1')).items.find((i) => i.parentId === dup.item.id && i.text === 'Label circuits')!;
    expect(copy).toMatchObject({ done: false, assigneeId: 'u2', dueDate: '2026-11-10' });
  });

  it('copies a whole checklist ("Electrical (copy)") right after it', async () => {
    const s = setup();
    await sample(s);
    const first = (await s.service.view('t1')).lists[0]!;
    await s.service.renameList(first.id, 'u1', 'Electrical');
    await s.service.addList('t1', 'u1', 'Fit-out');
    const dup = await s.service.duplicateList(first.id, 'u1');
    expect(dup).toMatchObject({ count: 4, title: 'Electrical', list: { title: 'Electrical (copy)', done: 0, total: 3 } });
    expect((await s.service.view('t1')).lists.map((l) => l.title)).toEqual(['Electrical', 'Electrical (copy)', 'Fit-out']);
  });
});

describe('safe deletes: Undo, Restore for 30 days, then gone', () => {
  it('deletes an item with its sub-items as one batch, and Undo brings them back where they were', async () => {
    const s = setup();
    const { panel } = await sample(s);
    const before = await texts(s);
    const del = await s.service.removeItem(panel.id, 'u1');
    expect(del).toMatchObject({ taskId: 't1', count: 3, text: 'Panel' });
    expect(await texts(s)).toEqual(['Lights']);
    expect(await s.service.deletedBatches('t1')).toEqual([expect.objectContaining({ batchId: del.batchId, kind: 'item', title: 'Panel', count: 3, deletedById: 'u1' })]);
    expect(await s.service.restore('t1', 'u2', del.batchId)).toMatchObject({ restored: 3, count: 3, kind: 'item', title: 'Panel' });
    expect(await texts(s)).toEqual(before);
    expect(await s.service.deletedBatches('t1')).toEqual([]);
    await expect(s.service.restore('t1', 'u2', del.batchId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes and restores a whole checklist', async () => {
    const s = setup();
    await sample(s);
    const list = (await s.service.view('t1')).lists[0]!;
    const del = await s.service.removeList(list.id, 'u1');
    expect(del.count).toBe(4);
    expect((await s.service.view('t1')).lists).toEqual([]);
    expect((await s.service.deletedBatches('t1'))[0]).toMatchObject({ kind: 'list', title: 'Checklist', count: 4 });
    await s.service.restore('t1', 'u1', del.batchId);
    expect(await texts(s)).toEqual(['Panel', '  Label circuits', '  Test RCD', 'Lights']);
  });

  it('an item whose parent was deleted after it comes back at the top level', async () => {
    const s = setup();
    const { panel, label } = await sample(s);
    const one = await s.service.removeItem(label.id, 'u1');
    await s.service.removeItem(panel.id, 'u1');
    await s.service.restore('t1', 'u1', one.batchId);
    expect(await texts(s)).toEqual(['Label circuits', 'Lights']);
  });

  it('can be restored for 30 days; the daily sweep then removes it for good', async () => {
    const s = setup();
    const { panel } = await sample(s);
    const del = await s.service.removeItem(panel.id, 'u1');
    clock = new Date(clock.getTime() + (RESTORE_DAYS + 1) * 86_400_000);
    expect(await s.service.deletedBatches('t1')).toEqual([]);
    await expect(s.service.restore('t1', 'u1', del.batchId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await s.service.purge()).toBe(3);
    expect(s.store.rows.items.map((i) => i.text)).toEqual(['Lights']);
  });
});

describe('trees: the New task form, templates and repeats', () => {
  it('makes rows from a tree, in order, nothing ticked', () => {
    const rows = rowsFromTree('t1', [{ title: 'Electrical', items: [{ text: 'Panel', children: [{ text: 'Label' }] }] }, { title: 'Fit-out', items: [{ text: 'Paint' }] }], 'u1', clock);
    const a = arrange(rows.lists, rows.items);
    expect(a.lists.map((l) => [l.title, l.total])).toEqual([['Electrical', 1], ['Fit-out', 1]]);
    expect(a.items.map((i) => `${i.depth}:${i.text}`)).toEqual(['0:Panel', '1:Label', '0:Paint']);
  });

  it('a repeat copies the checklists with ticks cleared, keeps people and moves dates with the task', async () => {
    const s = setup();
    const { label } = await sample(s);
    await s.service.updateItem(label.id, 'u1', { done: true, assigneeId: 'u2', dueDate: new Date('2026-11-10T00:00:00Z') });
    const source = (await s.store.read('t1'))!;
    const copy = copyRowsForRepeat(source, 't2', 7 * 86_400_000, clock);
    const a = arrange(copy.lists, copy.items);
    expect(a.items.map((i) => `${i.depth}:${i.text}:${i.done}`)).toEqual(['0:Panel:false', '1:Label circuits:false', '1:Test RCD:false', '0:Lights:false']);
    expect(a.items[1]).toMatchObject({ assigneeId: 'u2', dueDate: new Date('2026-11-17T00:00:00Z'), taskId: 't2' });
    expect(copyRowsForRepeat(source, 't2', null, clock).items.every((i) => i.dueDate === null)).toBe(true);
  });
});

describe('older data', () => {
  it('items from before 1.23.3 with no checklist are put in one titled "Checklist", in order', async () => {
    const s = setup();
    const base = { taskId: 't1', listId: null, parentId: null, done: false, createdAt: clock, updatedAt: clock, assigneeId: null, dueDate: null, completedAt: null, completedById: null, deletedAt: null, deletedById: null, deletedBatchId: null };
    s.store.rows.items.push({ ...base, id: 'b', text: 'Second', position: 1 }, { ...base, id: 'a', text: 'First', position: 0, done: true });
    const v = await s.service.view('t1');
    expect(v.lists.map((l) => l.title)).toEqual(['Checklist']);
    expect(v.items.map((i) => i.text)).toEqual(['First', 'Second']);
    expect(v).toMatchObject({ done: 1, total: 2, percent: 50 });
    expect(s.store.rows.items.every((i) => i.listId === v.lists[0]!.id)).toBe(true);
  });
});
