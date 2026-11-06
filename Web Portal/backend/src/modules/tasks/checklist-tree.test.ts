import { describe, it, expect } from 'vitest';
import {
  arrange,
  settleParents,
  leafCounts,
  descendantIds,
  wouldCycle,
  planMove,
  checklistTreeOf,
  flatTexts,
  treeLimits,
  type ItemRow,
  type ListRow,
} from './checklist-tree';

const at = new Date('2026-11-06T08:00:00Z');
function list(id: string, position = 0, extra: Partial<ListRow> = {}): ListRow {
  return { id, taskId: 't1', title: id, position, createdById: null, createdAt: at, updatedAt: at, deletedAt: null, deletedById: null, deletedBatchId: null, ...extra };
}
function item(id: string, parentId: string | null, position: number, extra: Partial<ItemRow> = {}): ItemRow {
  return {
    id, taskId: 't1', listId: 'L1', parentId, text: id, done: false, position, createdAt: at, updatedAt: at,
    assigneeId: null, dueDate: null, completedAt: null, completedById: null, deletedAt: null, deletedById: null, deletedBatchId: null, ...extra,
  };
}

describe('arrange', () => {
  it('orders lists by position and items depth-first by position, with depth and leaf counts', () => {
    const lists = [list('L2', 1), list('L1', 0)];
    const items = [
      item('b', null, 1),
      item('a', null, 0),
      item('a2', 'a', 1, { done: true }),
      item('a1', 'a', 0),
      item('a1x', 'a1', 0, { done: true }),
      item('z', null, 0, { listId: 'L2', done: true }),
    ];
    const view = arrange(lists, items);
    expect(view.items.map((i) => `${i.id}:${i.depth}`)).toEqual(['a:0', 'a1:1', 'a1x:2', 'a2:1', 'b:0', 'z:0']);
    const a = view.items.find((i) => i.id === 'a')!;
    expect(a).toMatchObject({ childCount: 2, subDone: 2, subTotal: 2 });
    expect(view.items.find((i) => i.id === 'b')).toMatchObject({ childCount: 0, subDone: 0, subTotal: 0 });
    // Leaves: a1x, a2, b, z → 3 of 4 done; per list L1 2/3, L2 1/1.
    expect(view.done).toBe(3);
    expect(view.total).toBe(4);
    expect(view.percent).toBe(75);
    expect(view.lists.map((l) => [l.id, l.done, l.total])).toEqual([['L1', 2, 3], ['L2', 1, 1]]);
  });

  it('leaves out deleted lists and items, and puts an item whose parent is gone at the top of its list', () => {
    const lists = [list('L1'), list('L9', 1, { deletedAt: at })];
    const items = [item('a', null, 0), item('gone', null, 1, { deletedAt: at }), item('lost', 'nowhere', 2), item('x', null, 0, { listId: 'L9' })];
    const view = arrange(lists, items);
    expect(view.lists.map((l) => l.id)).toEqual(['L1']);
    expect(view.items.map((i) => `${i.id}:${i.depth}:${i.parentId}`)).toEqual(['a:0:null', 'lost:0:null']);
  });
});

describe('leafCounts', () => {
  it('counts only the items without sub-items, so 8/12 is never double-counted', () => {
    const items = [item('p', null, 0), item('c1', 'p', 0, { done: true }), item('c2', 'p', 1), item('q', null, 1, { done: true })];
    expect(leafCounts(items)).toEqual({ done: 2, total: 3 });
  });
});

describe('settleParents (owner: a parent follows its sub-items)', () => {
  it('ticks a parent when all its sub-items are done, all the way up', () => {
    const items = [item('p', null, 0), item('c', 'p', 0), item('g1', 'c', 0, { done: true }), item('g2', 'c', 1, { done: true })];
    const changed = settleParents(items, { now: at, actorId: 'u1' });
    expect(changed.sort()).toEqual(['c', 'p']);
    expect(items.find((i) => i.id === 'p')).toMatchObject({ done: true, completedAt: at, completedById: 'u1' });
  });

  it('unticks a parent (and its parents) when one sub-item is reopened', () => {
    const items = [item('p', null, 0, { done: true }), item('c', 'p', 0, { done: true }), item('g1', 'c', 0, { done: false })];
    const changed = settleParents(items, { now: at, actorId: 'u1' });
    expect(changed.sort()).toEqual(['c', 'p']);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items.find((i) => i.id === 'p')!.completedAt).toBeNull();
  });

  it('a ticked parent given an open sub-item is unticked', () => {
    const items = [item('p', null, 0, { done: true }), item('c1', 'p', 0, { done: true }), item('new', 'p', 1)];
    settleParents(items, { now: at, actorId: 'u1' });
    expect(items.find((i) => i.id === 'p')!.done).toBe(false);
  });

  it('never ticks a parent with an open sub-item, and leaves leaves alone', () => {
    const items = [item('p', null, 0), item('c1', 'p', 0, { done: true }), item('c2', 'p', 1), item('leaf', null, 1, { done: true })];
    expect(settleParents(items, { now: at, actorId: 'u1' })).toEqual([]);
    expect(items.find((i) => i.id === 'leaf')!.done).toBe(true);
  });

  it('ignores deleted sub-items: a parent whose only open sub-item was deleted is done', () => {
    const items = [item('p', null, 0), item('c1', 'p', 0, { done: true }), item('c2', 'p', 1, { deletedAt: at })];
    expect(settleParents(items, { now: at, actorId: 'u1' })).toEqual(['p']);
  });

  it('a parent whose last sub-item goes keeps its tick and becomes a normal item', () => {
    const items = [item('p', null, 0, { done: true }), item('c1', 'p', 0, { done: true, deletedAt: at })];
    expect(settleParents(items, { now: at, actorId: 'u1' })).toEqual([]);
    expect(items[0]!.done).toBe(true);
  });
});

describe('descendants and circular moves', () => {
  const items = [item('a', null, 0), item('b', 'a', 0), item('c', 'b', 0), item('d', null, 1)];
  it('lists every sub-item, at any depth', () => expect(descendantIds(items, 'a').sort()).toEqual(['b', 'c']));
  it('refuses a move under itself or any of its sub-items', () => {
    expect(wouldCycle(items, 'a', 'a')).toBe(true);
    expect(wouldCycle(items, 'a', 'c')).toBe(true);
    expect(wouldCycle(items, 'a', 'd')).toBe(false);
    expect(wouldCycle(items, 'c', 'a')).toBe(false);
    expect(wouldCycle(items, 'a', null)).toBe(false);
  });
});

describe('planMove', () => {
  const items = [item('a', null, 0), item('a1', 'a', 0), item('b', null, 1), item('c', null, 2), item('c1', 'c', 0), item('c2', 'c', 1)];
  it('indent: under the item before it, as its last sub-item', () => {
    expect(planMove(items, 'b', 'indent')).toEqual({ listId: 'L1', parentId: 'a', afterId: 'a1' });
    expect(planMove(items, 'c2', 'indent')).toEqual({ listId: 'L1', parentId: 'c1', afterId: null });
    expect(planMove(items, 'a', 'indent')).toBeNull();
  });
  it('outdent: right after its parent, one level up', () => {
    expect(planMove(items, 'c1', 'outdent')).toEqual({ listId: 'L1', parentId: null, afterId: 'c' });
    expect(planMove(items, 'b', 'outdent')).toBeNull();
  });
  it('up / down: swaps with the sibling before / after', () => {
    expect(planMove(items, 'b', 'up')).toEqual({ listId: 'L1', parentId: null, afterId: null });
    expect(planMove(items, 'c', 'up')).toEqual({ listId: 'L1', parentId: null, afterId: 'a' });
    expect(planMove(items, 'b', 'down')).toEqual({ listId: 'L1', parentId: null, afterId: 'c' });
    expect(planMove(items, 'a', 'up')).toBeNull();
    expect(planMove(items, 'c', 'down')).toBeNull();
  });
});

describe('checklist trees (templates, the New task form)', () => {
  it('reads an old flat list of texts as one "Checklist"', () => {
    expect(checklistTreeOf(['One', ' Two ', ''])).toEqual([{ title: 'Checklist', items: [{ text: 'One' }, { text: 'Two' }] }]);
    expect(checklistTreeOf([])).toEqual([]);
    expect(checklistTreeOf(null)).toEqual([]);
  });
  it('reads a stored tree, keeping titles and nesting, dropping blanks and junk', () => {
    const stored = [{ title: ' Electrical ', items: [{ text: 'Panel', children: [{ text: 'Label circuits' }, { text: '  ' }] }, 7] }, { title: '', items: [] }];
    expect(checklistTreeOf(stored)).toEqual([
      { title: 'Electrical', items: [{ text: 'Panel', children: [{ text: 'Label circuits' }] }] },
      { title: 'Checklist', items: [] },
    ]);
  });
  it('flattens to every item text in order (what older apps read)', () => {
    expect(flatTexts([{ title: 'A', items: [{ text: 'x', children: [{ text: 'y' }] }] }, { title: 'B', items: [{ text: 'z' }] }])).toEqual(['x', 'y', 'z']);
  });
  it('checks the limits: depth, item count and checklist count', () => {
    let deep: { text: string; children?: unknown[] } = { text: 'leaf' };
    for (let i = 0; i < 20; i++) deep = { text: `l${i}`, children: [deep] };
    expect(treeLimits(checklistTreeOf([{ title: 'Deep', items: [deep] }]))).toMatch(/20 levels/);
    const many = [{ title: 'Many', items: Array.from({ length: 501 }, (_, i) => ({ text: `i${i}` })) }];
    expect(treeLimits(checklistTreeOf(many))).toMatch(/500 checklist items/);
    expect(treeLimits(checklistTreeOf(Array.from({ length: 51 }, () => ({ title: 'x', items: [] }))))).toMatch(/50 checklists/);
    expect(treeLimits(checklistTreeOf([{ title: 'Ok', items: [{ text: 'a' }] }]))).toBeNull();
  });
});
